from flask import Flask, request, jsonify
from flask import Response, request, stream_with_context
import os
from json_from_s3_file import get_json_from_s3_file, upload_json_to_s3
from embedding import process_s3_json
from query import hybrid_search, generate_answer_with_sources
import boto3
from flask_cors import CORS
from extract_structured import parse_chunks, get_chunks_from_s3_file, upload_structured_to_s3
import json, re
from botocore.exceptions import ClientError

app = Flask(__name__)
CORS(app)

REGION = os.getenv("AWS_REGION", "us-east-1")
PROCESSED_BUCKET = os.getenv("PROCESSED_BUCKET", "meddoc-processed")   # processed bucket
LLM_MODEL = os.getenv("LLM_MODEL", "amazon.nova-pro-v1:0")             # same model as query.py

s3 = boto3.client("s3", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION)          # Nova Pro lives in us-east-1

# === Summary helpers ===
def _base_json_name(original_filename: str) -> str:
    """'ABC.docx' -> 'ABC.json' (the chunks file you already write to meddoc-processed/<folder>/)."""
    return re.sub(r"\.[^.]+$", ".json", original_filename)

def _summary_key(folder: str, base_json_name: str) -> str:
    """Where we store the summary. Example: 'summaries/patients/ABC.md'."""
    base = re.sub(r"\.json$", "", base_json_name)
    return f"summaries/{folder}/{base}.md"

def _load_chunks_text(folder: str, base_json_name: str, cap_chars=12000, max_chunks=12) -> str:
    """
    Read meddoc-processed/<folder>/<base>.json and build a bounded context string
    from the first N chunks (keeps tokens/cost low).
    """
    key = f"{folder}/{base_json_name}"                     # e.g., patients/ABC.json
    obj = s3.get_object(Bucket=PROCESSED_BUCKET, Key=key)
    items = json.loads(obj["Body"].read().decode("utf-8")) # [{ text, page, ... }, ...]

    out, total = [], 0
    for ch in items[:max_chunks]:
        t = (ch.get("text") or "").strip()
        if not t:
            continue
        out.append(t)
        total += len(t)
        if total >= cap_chars:
            break
    return "\n\n".join(out)

def _summarize_with_nova(context: str, title: str) -> str:
    prompt = f"""
        You are a SUMMARY WRITER. Summarize "{title}" for Malaysian clinicians in LESS THAN 200 CHARACTERS.
        Plan your summary carefully. Keep it concise and to the point.
        If there is not enough CHARACTERS left to complete your summary, you may have a few extra CHARACTERS.

        Compile your answer WITHIN 1 (ONE) short paragraph consisting only the most critical facts.
        DO NOT USE FORMATTINGS, BULLETS, OR NEWLINES. Use PLAINTEXT ONLY.
        Facts must come only from the context below:

        <START CONTEXT>

        {context}

        <END CONTEXT>
    """
    body = {
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": 100, "temperature": 0.2, "topP": 0.9},
    }
    resp = bedrock.converse(modelId=LLM_MODEL, **body)
    blocks = resp.get("output", {}).get("message", {}).get("content", [])
    text = "".join(b.get("text", "") for b in blocks).strip().replace("\n", " ")

    return text

def generate_and_store_summary(folder: str, original_filename: str) -> str:
    """
    Generate once per document. If a summary already exists, return its key.
    Saves to: meddoc-processed/summaries/<folder>/<base>.md
    """
    base_json = _base_json_name(original_filename)
    skey = _summary_key(folder, base_json)

    # Build context from your already-produced chunks JSON
    context = _load_chunks_text(folder, base_json)
    if not context:
        raise RuntimeError("Empty/invalid chunks for summarization")

    # Call Nova Pro and store Markdown summary
    summary_md = _summarize_with_nova(context, title=original_filename)
    s3.put_object(
        Bucket=PROCESSED_BUCKET,
        Key=skey,
        Body=summary_md.encode("utf-8"),
        ContentType="text/markdown; charset=utf-8",
    )
    return skey

@app.route("/process", methods=["POST"])
def process():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Invalid or missing JSON"}), 400

    s3_folder = data.get("folder")
    s3_file = data.get("file")

    if not s3_folder or not s3_file:
        return jsonify({"error": "Missing folder or file"}), 400

    print(f"Received request for folder: {s3_folder}, file: {s3_file}")
    s3_structured_output_key = None

    try:
        # Assume get_json_from_s3_file fetches JSON from the original S3 file
        json_data = get_json_from_s3_file(s3_folder, s3_file)
        # Upload processed JSON to S3
        s3_output_key = upload_json_to_s3(json_data, s3_folder, s3_file)
        based_name = os.path.splitext(os.path.basename(s3_file))[0]
        s3_file_json = f"{based_name}.json"
        print("folder name", s3_folder)
        # only process if the folder is patients
        if s3_folder == "patients":
            structured_data = get_chunks_from_s3_file(s3_folder, s3_file_json)
            s3_structured_output_key = upload_structured_to_s3(structured_data, s3_folder)
            print(f"Extracted structured data: {structured_data}")
        result = process_s3_json(s3_folder, s3_file_json)

        # === Generate + store AI summary (once per doc) ===
        try:
            summary_s3_key = generate_and_store_summary(s3_folder, s3_file)
        except Exception as se:
            # Don't fail the whole pipeline if summarization has a hiccup
            print(f"[WARN] Summary generation failed for {s3_folder}/{s3_file}: {se}")
            summary_s3_key = None

        return jsonify({
            "message": "Processing successful",
            "s3_key": s3_output_key,
            "s3_structured_key": s3_structured_output_key if s3_folder == "patients" else None,
            "result": result,
            "summary_key": summary_s3_key
        })    

    except Exception as e:
        print(f"Error during processing: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/ask", methods=["GET"])
def ask_question_stream():
    q = request.args.get("question", "")
    session_id = request.args.get("session_id", "default")

    def generate():
        try:
            yield "data: " + json.dumps({"status": "🔍 Retrieving patient record"}) + "\n\n"
            search_result = hybrid_search(q, session_id=session_id, top_k=5)
            contexts, processed_query = search_result

            yield "data: " + json.dumps({"status": "📖 Extracting highlights"}) + "\n\n"
            contexts_preview = []
            for i, c in enumerate(contexts):
                if isinstance(c, dict) and "text" in c:
                    contexts_preview.append({"text": c["text"][:200]})

            yield "data: " + json.dumps({"status": "🤖 Generating answer"}) + "\n\n"
            answer, sources, suggestions = generate_answer_with_sources(
                q, contexts, session_id, processed_query
            )

            payload = {
                "question": q,
                "answer": answer,
                "sources": sources,
                "suggestions": suggestions
            }
            yield "data: " + json.dumps(payload) + "\n\n"

        except Exception as e:
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=True)
