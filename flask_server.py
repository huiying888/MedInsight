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
    print("=== ask_question called - updated version ===")
    try:
        data = request.get_json()
        if not data or "question" not in data:
            return jsonify({"error": "Missing 'question' in request body"}), 400

        q = data["question"]
        session_id = data.get("session_id", "default")

        # Get search results
        search_result = hybrid_search(q, session_id=session_id, top_k=5)
        print(f"Search result type: {type(search_result)}")
        print(f"Search result: {search_result}")
        
        # Unpack the tuple
        contexts, processed_query = search_result
        print(f"Contexts type: {type(contexts)}, length: {len(contexts) if isinstance(contexts, list) else 'N/A'}")
        
        # Validate contexts is a list of dictionaries
        if not isinstance(contexts, list):
            return jsonify({"error": f"Expected contexts to be a list, got {type(contexts)}"}), 500
            
        # Create contexts preview safely
        contexts_preview = []
        for i, c in enumerate(contexts):
            if isinstance(c, dict) and "text" in c:
                contexts_preview.append({"text": c["text"][:200]})
            else:
                print(f"Warning: Context {i} is not a valid dict with 'text' key: {type(c)}")
        
        answer, sources, suggestions = generate_answer_with_sources(q, contexts, session_id, processed_query)
        print(f"Question: {q}\nAnswer: {answer}")
        
        return jsonify({
            "question": q,
            "contexts": contexts_preview,
            "answer": answer.replace("\r\n", "\n").replace("\n", "\n"),
            "sources": sources,
            "suggestions": suggestions
        })
    except Exception as e:
        print(f"Error in ask_question: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=True)
