import boto3
import json
import os
import time
import botocore
import faiss
import numpy as np

# -------------------------------
# Config
# -------------------------------
REGION = "us-east-1"
BEDROCK_MODEL = "amazon.titan-embed-text-v1"
S3_INPUT_BUCKET = "meddoc-processed"        # input (your JSONs)
S3_VECTOR_BUCKET = "meddoc-vectorstore"     # output (store FAISS index + metadata)
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
INDEX_FILE = "index.faiss"
META_FILE = "metadata.json"

# -------------------------------
# Clients
# -------------------------------
s3 = boto3.client(
    "s3",
    region_name=REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY
)

bedrock = boto3.client("bedrock-runtime", region_name=REGION)

# -------------------------------
# Get embedding from Bedrock
# -------------------------------
def get_embedding(text):
    for attempt in range(5):
        try:
            response = bedrock.invoke_model(
                modelId=BEDROCK_MODEL,
                body=json.dumps({"inputText": text})
            )
            resp_body = json.loads(response["body"].read())
            return np.array(resp_body["embedding"], dtype="float32")
        except botocore.exceptions.ClientError as e:
            if e.response['Error']['Code'] == 'ThrottlingException':
                print("⏳ Throttled by Bedrock, retrying...")
                time.sleep(2 ** attempt)
            else:
                raise
    raise Exception("❌ Failed to get embedding after retries")

# -------------------------------
# Build or update FAISS index
# -------------------------------
def build_or_update_faiss(embeddings, metadata_list):
    # Try loading existing index + metadata
    try:
        s3.download_file(S3_VECTOR_BUCKET, INDEX_FILE, INDEX_FILE)
        s3.download_file(S3_VECTOR_BUCKET, META_FILE, META_FILE)
        index = faiss.read_index(INDEX_FILE)
        with open(META_FILE, "r") as f:
            existing_metadata = json.load(f)
        print("📥 Existing FAISS index + metadata loaded.")
    except Exception:
        index = None
        existing_metadata = []
        print("⚠️ No existing index found, creating new one.")

    # Deduplicate based on (file, chunk_id)
    existing_keys = {(m["file"], m["chunk_id"]) for m in existing_metadata}
    new_embeddings = []
    new_metadata = []

    for emb, meta in zip(embeddings, metadata_list):
        key = (meta["file"], meta["chunk_id"])
        if key not in existing_keys:
            new_embeddings.append(emb)
            new_metadata.append(meta)

    if not new_embeddings:
        print("✅ No new data to add.")
        return

    new_embeddings = np.vstack(new_embeddings)

    # If first time, init FAISS
    if index is None:
        dim = new_embeddings.shape[1]
        index = faiss.IndexFlatL2(dim)

    # Append new data
    index.add(new_embeddings)
    all_metadata = existing_metadata + new_metadata

    # Save updated index + metadata
    faiss.write_index(index, INDEX_FILE)
    with open(META_FILE, "w") as f:
        json.dump(all_metadata, f)

    # Upload back to S3
    s3.upload_file(INDEX_FILE, S3_VECTOR_BUCKET, INDEX_FILE)
    s3.upload_file(META_FILE, S3_VECTOR_BUCKET, META_FILE)
    print(f"🎉 FAISS index updated with {len(new_metadata)} new chunks.")

# -------------------------------
# Process JSON from S3
# -------------------------------
def process_s3_json(folder=None, file=None):
    prefix = f"{folder}/" if folder else ""
    resp = s3.list_objects_v2(Bucket=S3_INPUT_BUCKET, Prefix=prefix)
    if "Contents" not in resp:
        print(f"⚠️ No files found in folder '{folder}'.")
        return

    all_embeddings = []
    all_metadata = []

    for obj in resp["Contents"]:
        key = obj["Key"]
        if not key.endswith(".json"):
            continue
        if file and os.path.basename(key) != file:
            continue

        print(f"📥 Processing {key} ...")
        try:
            file_obj = s3.get_object(Bucket=S3_INPUT_BUCKET, Key=key)
            content = file_obj["Body"].read().decode("utf-8")
            json_data = json.loads(content)
            
            for ch in json_data:
                emb = get_embedding(ch["text"])
                all_embeddings.append(emb)

                metadata = {
                    "file": key,
                    "chunk_id": ch["chunk_id"],
                    "text": ch["text"],
                    "page": ch.get("page"),
                    "source": ch.get("source"),
                    "type": ch.get("type")
                }
                all_metadata.append(metadata)
        except Exception as e:
            print(f"❌ Error processing {key}: {e}")
            continue

    if all_embeddings:
        embeddings_np = np.vstack(all_embeddings)
        build_or_update_faiss(embeddings_np, all_metadata)
        print("🎉 Done! All chunks processed and indexed into FAISS.")



# -------------------------------
# Main
# -------------------------------
if __name__ == "__main__":
    # Process and store FAISS (append mode)
    process_s3_json(folder="patients")   # or "guidelines", "knowledge"


