import boto3
import json
import os
import time
import botocore
import faiss
import numpy as np
import spacy
from typing import List, Dict

# -------------------------------
# Config
# -------------------------------
REGION = "us-east-1"
BEDROCK_MODEL = "amazon.titan-embed-text-v1"
LLM_MODEL = "amazon.nova-pro-v1:0"
S3_INPUT_BUCKET = "meddoc-processed"        # input (your JSONs)
S3_VECTOR_BUCKET = "meddoc-vectorstore"     # output (store FAISS index + metadata)

INDEX_FILE = "index.faiss"
META_FILE = "metadata.json"

# -------------------------------
# Clients
# -------------------------------
s3 = boto3.client("s3", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION)

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

def hybrid_search(query, top_k=3, keyword_hits=5):
    faiss_results = query_faiss(query, k=top_k)
    print(f"🔹 FAISS returned {len(faiss_results)} results")

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
    return resp_body["output"]["message"]["content"][0]["text"].strip()

def generate_answer_with_sources(question, contexts):
    # Main answer
    context_text = "\n\n".join([c["text"] for c in contexts])
    prompt = f"""You are a medical assistant.
Use the following patient records,knowledge base and guidelines to answer the question clearly and accurately.
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
    answer = resp_body["output"]["message"]["content"][0]["text"]

    # Add sources + highlights
    sources = []
    for c in contexts:
        highlight = extract_highlight(question, c["text"])
        sources.append({
            "file": c.get("file"),
            "page": c.get("page"),
            "source": c.get("source"),
            "highlight": highlight
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
