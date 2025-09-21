import boto3
import json
import os
import time
import botocore
import faiss
import numpy as np
import spacy
from typing import List, Dict
from urllib.parse import quote
import re

# -------------------------------
# Config
# -------------------------------
REGION = "us-east-1"
BEDROCK_MODEL = "amazon.titan-embed-text-v1"
LLM_MODEL = "amazon.nova-pro-v1:0"
S3_INPUT_BUCKET = "meddoc-processed"        # input (your JSONs)
S3_VECTOR_BUCKET = "meddoc-vectorstore"     # output (store FAISS index + metadata)

SOURCE_BUCKET = os.getenv("SOURCE_BUCKET", "meddoc-raw")
SOURCE_REGION = os.getenv("SOURCE_REGION", os.getenv("AWS_REGION", "us-east-1"))

INDEX_FILE = "index.faiss"
META_FILE = "metadata.json"

# -------------------------------
# Clients
# -------------------------------
s3 = boto3.client("s3", region_name=REGION)
s3_sign = boto3.client("s3", region_name=SOURCE_REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION)

def normalize_s3_key(raw: str) -> str | None:
    """Return a clean S3 key like 'patients/Patient Data 15.pdf' from various inputs."""
    if not raw:
        return None
    key = str(raw).strip()

    # 1) If full s3:// URL, drop scheme + bucket
    if key.startswith("s3://"):
        without_scheme = key[5:]
        parts = without_scheme.split("/", 1)  # ["bucket", "rest/of/key"]
        key = parts[1] if len(parts) == 2 else ""

    # 2) If https URL to S3 website/virtual-hosted style, strip origin
    if key.startswith("https://"):
        m = re.search(r"\.amazonaws\.com/(.+)$", key)
        if m:
            key = m.group(1)

    # 3) Strip fragment and query (important!)
    key = key.split("#", 1)[0]
    key = key.split("?", 1)[0]

    # 4) Remove any accidental leading slash
    return key.lstrip("/")

def build_public_url(key: str) -> str:
    base = f"https://{SOURCE_BUCKET}.s3.{SOURCE_REGION}.amazonaws.com"
    return f"{base}/{quote(key, safe='/')}"  # keep "/" but encode spaces etc.

def build_presigned_get(key: str, ttl_sec: int = 600) -> str:
    return s3_sign.generate_presigned_url(
        "get_object",
        Params={"Bucket": SOURCE_BUCKET, "Key": key},
        ExpiresIn=ttl_sec,
    )

# -------------------------------
# Get embedding from Bedrock
# -------------------------------
def get_embedding(text: str) -> np.ndarray:
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
# Query FAISS
# -------------------------------
def query_faiss(question, k=3):
    s3.download_file(S3_VECTOR_BUCKET, INDEX_FILE, INDEX_FILE)
    s3.download_file(S3_VECTOR_BUCKET, META_FILE, META_FILE)

    index = faiss.read_index(INDEX_FILE)
    with open(META_FILE, "r") as f:
        metadata = json.load(f)

    query_vec = get_embedding(question).reshape(1, -1)
    D, I = index.search(query_vec, k)
    results = [metadata[i] for i in I[0]]
    return results

# -------------------------------
# Keyword + Hybrid Search
# -------------------------------

nlp = spacy.load("en_core_web_sm")

def extract_keywords(query):
    doc = nlp(query)
    keywords = []

    # Also keep named entities (e.g. PERSON names)
    for ent in doc.ents:
        if ent.label_ in ["PERSON"]:  # People
            keywords.append(ent.text)

    # Deduplicate & lowercase
    print("Keyword Detected: ", keywords)
    return keywords

def keyword_search(query, max_hits=5):
    with open(META_FILE, "r") as f:
        metadata = json.load(f)
    results = []
    for idx, chunk in enumerate(metadata):
        if query.lower() in chunk["text"].lower():
            results.append(chunk)
            if len(results) >= max_hits:
                break
    return results

def hybrid_search(query, top_k=None, keyword_hits=5):
    """Dynamic search that adapts number of contexts based on query length and results."""
    # Dynamically set top_k if not provided
    if top_k is None:
        # Example: shorter queries get more contexts, longer queries fewer
        top_k = 10 if len(query.split()) <= 3 else 5

    faiss_results = query_faiss(query, k=top_k)
    keyword_results = []
    for q in extract_keywords(query):
        keyword_results.extend(keyword_search(q, max_hits=keyword_hits))

    seen = {id(r) for r in faiss_results}
    merged = faiss_results.copy()
    for r in keyword_results:
        if id(r) not in seen:
            merged.append(r)

    print(f"🔹 Total merged results: {len(merged)}")
    return merged
# -------------------------------
# Generate Answer with Nova Pro
# -------------------------------
def generate_answer(question, contexts):
    context_text = "\n\n".join([c["text"] for c in contexts])
    prompt = f"""You are a medical assistant.
Use the following patient records to answer the question clearly and accurately.
If the answer is not in the records, say so.

Context:
{context_text}

Question:
{question}

Answer:"""

    response = bedrock.invoke_model(
        modelId=LLM_MODEL,
        body=json.dumps({
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": 512, "temperature": 0.2, "topP": 0.9}
        })
    )
    resp_body = json.loads(response["body"].read())
    return resp_body["output"]["message"]["content"][0]["text"]

def extract_highlight(question, chunk_text):
    """Ask LLM to return the most relevant sentence(s) from chunk."""
    prompt = f"""
    Extract the most relevant sentence(s) from the following text that directly answer the question. 
    If nothing relevant, return 'N/A'.

    Question: {question}
    Text: {chunk_text}
    """
    response = bedrock.invoke_model(
        modelId=LLM_MODEL,
        body=json.dumps({
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": 128, "temperature": 0.0}
        })
    )
    resp_body = json.loads(response["body"].read())
    highlight = resp_body["output"]["message"]["content"][0]["text"]
    return highlight.strip()


def generate_answer_with_sources(question, contexts):
    # Main answer
    # --- Extract patient name from the question ---
    match = re.search(r"patient\s+([\w\s]+)", question.lower())
    patient_name = match.group(1).strip() if match else None

    # --- Filter contexts for that patient only ---
    filtered_contexts = contexts
    if patient_name:
        filtered_contexts = [
            c for c in contexts if patient_name in c["text"].lower()
        ]
        if not filtered_contexts:
            return f"No records found for patient {patient_name.title()}.", []

    context_text = "\n\n".join([c["text"] for c in filtered_contexts])
    prompt = f"""You are a medical assistant.
Use the following patient records, knowledge base and guidelines to answer the question clearly and accurately.
If the answer is not in the records, say so.

Instructions:
- Always answer in the following structured format.
- If the question asks for a single patient, output exactly like this:

Example:
Question: I want the detail of John Doe
Answer:
Here are the details for patient John Doe:
Hospital: Demo General Hospital
NRIC: 123456-78-9012
Age: 45 years old
Gender: Male
Blood type: A+
Allergies: None
[Add extra fields if available]

Now, follow this format strictly.
- If the question asks for all patients, provide a structured list (one entry per patient).
- Never mix unrelated patients together unless explicitly requested.

Context:
{context_text}

Question:
{question}

Answer:"""

    response = bedrock.invoke_model(
        modelId=LLM_MODEL,
        body=json.dumps({
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": 512, "temperature": 0.2, "topP": 0.9}
        })
    )
    resp_body = json.loads(response["body"].read())
    answer = resp_body["output"]["message"]["content"][0]["text"]

    # Add sources + highlights (skip N/A)
    sources = []
    seen = {}
    for c in contexts:
        hl = extract_highlight(question, c["text"]) or ""
        norm = hl.strip().lower()
        if not norm or "n/a" in norm:
            continue

        raw = c.get("source") or c.get("s3_key") or c.get("file") or ""
        key = normalize_s3_key(raw)
        if not key:
            continue

        # choose presigned (private bucket) or public
        url = build_presigned_get(key, ttl_sec=600)
        # IMPORTANT: Append #page AFTER signing (not part of the key/signature)
        page = c.get("page")
        if page:
            url = f"{url}#page={page}"

        sources.append({
            "file": c.get("file") or key.split("/")[-1],
            "page": page,
            "key": key,
            "url": url,
            "highlight": hl.strip(),
        })

    return answer, sources



# -------------------------------
# Main
# -------------------------------
if __name__ == "__main__":
    while True:
        q = input("Ask Anything> ")
        contexts = hybrid_search(q, top_k=5)
        print("🔍 Retrieved Contexts:")
        for c in contexts:
            print("-", c["text"][:200], "...")

        # answer = generate_answer(q, contexts)
        # print("\n🤖 Nova Pro Answer:\n", answer)
        # print("\n🔦 Highlights:")
        answer, sources = generate_answer_with_sources(q, contexts)

        print("\n🤖 Nova Pro Answer:\n", answer)
        print("\n📚 Sources:")
        for s in sources:
            print(f"- {s['source']} (Page {s['page']})")
            print(f"  🔎 Highlight: {s['highlight']}\n")
