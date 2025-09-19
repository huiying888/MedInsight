import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
import os

# -------------------------------
# Config
# -------------------------------
REGION = "us-east-1"
BEDROCK_MODEL = "amazon.titan-embed-text-v1"
OPENSEARCH_HOST = "search-medinsight-nustara26rqh6g7h7xgqgfo5ze.us-east-1.es.amazonaws.com"
INDEX_NAME = "meddoc"
S3_BUCKET = "meddoc-processed"
USERNAME = "username"
PASSWORD = "Hynhy@25110204"

# -------------------------------
# Clients
# -------------------------------
s3 = boto3.client("s3", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION)

opensearch = OpenSearch(
    hosts=[{"host": OPENSEARCH_HOST, "port": 443}],
    http_auth=(USERNAME, PASSWORD),
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

# -------------------------------
# Create index with mapping
# -------------------------------

def create_index():
    mapping = {
        "settings": {
            "index": {
                "knn": True   # enable kNN
            }
        },
        "mappings": {
            "properties": {
                "text": {"type": "text"},
                "embedding": {
                    "type": "knn_vector",
                    "dimension": 1536   # Titan embedding size
                },
                "metadata": {"type": "object"}
            }
        }
    }

    if not opensearch.indices.exists(index=INDEX_NAME):
        opensearch.indices.create(index=INDEX_NAME, body=mapping)
        print(f"✅ Index '{INDEX_NAME}' created with k-NN enabled.")
    else:
        print(f"ℹ️ Index '{INDEX_NAME}' already exists.")


# -------------------------------
# Get embedding from Bedrock
# -------------------------------
def get_embedding(text):
    response = bedrock.invoke_model(
        modelId=BEDROCK_MODEL,
        body=json.dumps({"inputText": text})
    )
    resp_body = json.loads(response["body"].read())
    return resp_body["embedding"]

# -------------------------------
# Index document into OpenSearch
# -------------------------------
def index_document(doc_id, text, metadata):
    vector = get_embedding(text)
    doc = {
        "text": text,
        "embedding": vector,
        "metadata": metadata
    }
    opensearch.index(index=INDEX_NAME, id=doc_id, body=doc)

# -------------------------------
# Process JSON from S3
# -------------------------------
def process_s3_json(folder=None, file=None):
    if folder:
        prefix = f"{folder}/"
    else:
        prefix = ""

    resp = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
    if "Contents" not in resp:
        print(f"⚠️ No files found in folder '{folder}'.")
        return

    for obj in resp["Contents"]:
        key = obj["Key"]
        if not key.endswith(".json"):
            continue
        if file and os.path.basename(key) != file:
            continue

        print(f"📥 Processing {key} ...")

        # Get file content
        file_obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        content = file_obj["Body"].read().decode("utf-8")
        json_data = json.loads(content)

        # Each JSON file may have multiple chunks
        for ch in json_data:
            metadata = {
                "page": ch.get("page"),
                "source": ch.get("source"),
                "type": ch.get("type")
            }
            doc_id = f"{ch['type']}_{ch['chunk_id']}"
            index_document(doc_id, ch["text"], metadata)
            print(f"✅ Indexed: {doc_id}")

# -------------------------------
# Main
# -------------------------------
if __name__ == "__main__":
    create_index()
    # Example usage:
    process_s3_json(folder="patients", file="cf7db441e5ee48759231bb00a5111c74_Patient Data 1.json")
    # process_s3_json(folder="patients")  # To process all files in 'patients'
    # process_s3_json()  # To process all files in all folders
    print("🎉 Done! All chunks processed and indexed.")
