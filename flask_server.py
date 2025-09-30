from flask import Flask, request, jsonify
import os
from json_from_s3_file import get_json_from_s3_file, upload_json_to_s3
from embedding import process_s3_json
from query import hybrid_search, generate_answer_with_sources
import boto3
from flask_cors import CORS
from extract_structured import parse_chunks, get_chunks_from_s3_file, upload_structured_to_s3

app = Flask(__name__)
CORS(app)

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

        return jsonify({
            "message": "Processing successful",
            "s3_key": s3_output_key,
            "s3_structured_key": s3_structured_output_key if s3_folder == "patients" else None,
            "result": result
        })
    

    except Exception as e:
        print(f"Error during processing: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/ask", methods=["POST"])
def ask_question():
    data = request.get_json()
    if not data or "question" not in data:
        return jsonify({"error": "Missing 'question' in request body"}), 400

    q = data["question"]

    contexts = hybrid_search(q, top_k=5)
    contexts_preview = [{"text": c["text"][:200]} for c in contexts]
    answer, sources = generate_answer_with_sources(q, contexts)
    print(f"Question: {q}\nAnswer: {answer}")
    
    return jsonify({
        "question": q,
        "contexts": contexts_preview,
        "answer": answer.replace("\r\n", "\n").replace("\n", "\n"),
        "sources": sources
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=True)
