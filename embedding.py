import boto3
import json
import os
import time
import botocore
from botocore.exceptions import ClientError
import faiss
import numpy as np
from threading import Lock

faiss_lock = Lock()

# -------------------------------
# Config
# -------------------------------
REGION = "us-east-1"
BEDROCK_MODEL = "amazon.titan-embed-text-v1"
S3_INPUT_BUCKET = "meddoc-processed"        # input (your JSONs)
S3_VECTOR_BUCKET = "meddoc-vectorstore"     # output (store FAISS index + metadata)
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
# INDEX_FILE = "index.faiss"
# META_FILE = "metadata.json"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # folder where this script lives
LOCAL_FAISS_DIR = os.path.join(BASE_DIR, "faiss")
os.makedirs(LOCAL_FAISS_DIR, exist_ok=True)
INDEX_FILE = os.path.join(LOCAL_FAISS_DIR, "index.faiss")
META_FILE = os.path.join(LOCAL_FAISS_DIR, "metadata.json")

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
            print(f"Calling Bedrock invoke_model (attempt {attempt+1}) ...")
            response = bedrock.invoke_model(
                modelId=BEDROCK_MODEL,
                body=json.dumps({"inputText": text})
            )
            print("Got response object from Bedrock")

            print("Reading response body ...")
            body_bytes = response["body"].read()
            print(f"Read {len(body_bytes)} bytes")

            print("Parsing JSON response ...")
            resp_body = json.loads(body_bytes)
            print("Parsed response keys:", list(resp_body.keys()))

            emb = resp_body.get("embedding")
            if not emb:
                raise ValueError("No 'embedding' key in Bedrock response!")

            print(f"Embedding received with length {len(emb)}")
            return np.array(emb, dtype="float32")

        except botocore.exceptions.ClientError as e:
            if e.response['Error']['Code'] == 'ThrottlingException':
                print("Throttled by Bedrock, retrying...")
                time.sleep(2 ** attempt)
            else:
                print("Bedrock ClientError:", e)
                raise
        except Exception as e:
            print("General exception in get_embedding:", e)
            raise

    raise Exception("Failed to get embedding after retries")


# -------------------------------
# Build or update FAISS index (local only)
# -------------------------------
def build_or_update_faiss(embeddings, metadata_list):
    with faiss_lock:
        index = None
        existing_metadata = []

        # Try load existing FAISS index from local disk
        if os.path.exists(INDEX_FILE) and os.path.exists(META_FILE):
            try:
                index = faiss.read_index(INDEX_FILE)
                with open(META_FILE, "r") as f:
                    existing_metadata = json.load(f)
                print(f"Existing FAISS index loaded with {index.ntotal} vectors")
            except Exception as e:
                print(f"Failed to load existing FAISS index: {e}")
                index = None
                existing_metadata = []
        else:
            print("No existing FAISS index found locally. A new one will be created.")

        # Deduplicate based on (file, chunk_id)
        existing_keys = {(m["file"], m["chunk_id"]) for m in existing_metadata}
        new_embeddings, new_metadata = [], []

        for emb, meta in zip(embeddings, metadata_list):
            key = (meta["file"], meta["chunk_id"])
            if key not in existing_keys:
                new_embeddings.append(emb)
                new_metadata.append(meta)

        if not new_embeddings:
            print("No new data to add.")
            return

        new_embeddings = np.vstack(new_embeddings)

        # If first time, init FAISS
        if index is None:
            dim = new_embeddings.shape[1]
            index = faiss.IndexFlatL2(dim)
            print(f"Created new FAISS index with dim={dim}")

        # Append new data
        index.add(new_embeddings)
        all_metadata = existing_metadata + new_metadata

        # Save updated index + metadata locally
        faiss.write_index(index, INDEX_FILE)
        with open(META_FILE, "w") as f:
            json.dump(all_metadata, f)
        print(f"FAISS index saved at: {os.path.abspath(INDEX_FILE)}")
        print(f"Metadata saved at: {os.path.abspath(META_FILE)}")
        print(f"FAISS index updated with {len(new_metadata)} new chunks. Total vectors: {index.ntotal}")

# -------------------------------
# Process JSON from S3
# -------------------------------
def process_s3_json(folder=None, file=None):
    prefix = f"{folder}/" if folder else ""
    resp = s3.list_objects_v2(Bucket=S3_INPUT_BUCKET, Prefix=prefix)


    if "Contents" not in resp:
        print(f"No files found in folder '{folder}'.")
        return

    all_embeddings = []
    all_metadata = []

    for obj in resp["Contents"]:
        key = obj["Key"]
        if not key.endswith(".json"):
            continue
        if file and os.path.basename(key) != file:
            continue

        try:
            file_obj = s3.get_object(Bucket=S3_INPUT_BUCKET, Key=key)
            content = file_obj["Body"].read().decode("utf-8")
            json_data = json.loads(content)

            for ch in json_data:
                emb = get_embedding(ch["text"])
                all_embeddings.append(emb)
                print("Appending metadata")
                
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
            raise RuntimeError(f"Hard failure while processing {key}: {e}")

    if all_embeddings:
        embeddings_np = np.vstack(all_embeddings)
        build_or_update_faiss(embeddings_np, all_metadata)
        print("Done! All chunks processed and indexed into FAISS.")



# -------------------------------
# Main
# -------------------------------
if __name__ == "__main__":
    # Process and store FAISS (append mode)
    process_s3_json(folder="patients")   # or "guidelines", "knowledge"


