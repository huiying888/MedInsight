import boto3
import json
import os
import time
import botocore
import faiss
import numpy as np
import spacy
from typing import List, Dict, Optional
from urllib.parse import quote
import re
from collections import defaultdict

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
# -------------------------------
# Chat Memory + Patient Tracking
# -------------------------------
chat_memory: Dict[str, List[Dict]] = {}  # {session_id: [{"role": "user/assistant", "content": "..."}]}
current_patient: Dict[str, Optional[str]] = {}  # {session_id: "Ali bin Hassan"}

def add_to_memory(session_id: str, role: str, content: str):
    if session_id not in chat_memory:
        chat_memory[session_id] = []
    chat_memory[session_id].append({"role": role, "content": content})

def get_memory_context(session_id: str, max_turns=5) -> str:
    if session_id not in chat_memory:
        return ""
    history = chat_memory[session_id][-max_turns:]  # keep last N exchanges
    return "\n".join([f"{m['role'].capitalize()}: {m['content']}" for m in history])

def reset_memory(session_id: str):
    if session_id in chat_memory:
        del chat_memory[session_id]


# -------------------------------
# Utils
# -------------------------------        
def normalize_s3_key(raw: str) -> Optional[str]:
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

    results = []
    for idx in I[0]:
        if idx == -1 or idx >= len(metadata):
            continue
        results.append(metadata[idx])
    return results
# -------------------------------
# Keyword + Hybrid Search
# -------------------------------

nlp = spacy.load("en_core_web_sm")

def extract_patient_names(query):
    """Extract patient names from query using multiple methods."""
    doc = nlp(query)
    names = []
    
    # Method 1: Named Entity Recognition
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            names.append(ent.text.strip())
    
    # Method 2: Pattern matching for common formats
    patterns = [
        r"(?:patient|mr\.?|mrs\.?|ms\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
        r"([A-Z][a-z]+\s+bin\s+[A-Z][a-z]+)",  # Malaysian format
        r"([A-Z][a-z]+\s+binti\s+[A-Z][a-z]+)",  # Malaysian format
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?:'s|\s+(?:data|record|report|result))"
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, query, re.IGNORECASE)
        names.extend([match.strip() for match in matches])
    
    # Clean and deduplicate
    cleaned_names = []
    for name in names:
        name = re.sub(r'^(mr|mrs|ms|patient)\s+', '', name, flags=re.IGNORECASE).strip()
        if name and len(name.split()) <= 4:  # reasonable name length
            cleaned_names.append(name)
    
    # Remove duplicates while preserving order
    unique_names = []
    for name in cleaned_names:
        if name.lower() not in [n.lower() for n in unique_names]:
            unique_names.append(name)
    
    print("Patient names detected:", unique_names)
    return unique_names

def extract_keywords(query):
    """Extract general keywords for search."""
    doc = nlp(query)
    keywords = []
    
    # Extract patient names
    patient_names = extract_patient_names(query)
    keywords.extend(patient_names)
    
    # Extract other important entities
    for ent in doc.ents:
        if ent.label_ in ["ORG", "GPE", "DATE", "CARDINAL"]:
            keywords.append(ent.text)
    
    print("Keywords detected:", keywords)
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

def hybrid_search(query, session_id="default", top_k=None, keyword_hits=5):
    """Dynamic search with patient context awareness."""
    # Update patient context and resolve pronouns
    processed_query = update_patient_context(query, session_id)
    
    # Dynamically set top_k if not provided
    if top_k is None:
        top_k = 10 if len(processed_query.split()) <= 3 else 5

    # Use processed query for FAISS search
    faiss_results = query_faiss(processed_query, k=top_k)
    
    # Extract keywords from processed query
    keywords = extract_keywords(processed_query)
    keyword_results = []
    for keyword in keywords:
        keyword_results.extend(keyword_search(keyword, max_hits=keyword_hits))

    # Merge results
    seen = {id(r) for r in faiss_results}
    merged = faiss_results.copy()
    for r in keyword_results:
        if id(r) not in seen:
            merged.append(r)

    # Filter by current patient if available
    current_patient_name = get_patient_context(session_id)
    if current_patient_name:
        patient_filtered = []
        
        for result in merged:
            if current_patient_name.lower() in result["text"].lower():
                patient_filtered.append(result)
        
        # If we have patient-specific results, use only those
        if patient_filtered:
            merged = patient_filtered
            print(f"🔹 Using only {len(patient_filtered)} patient-specific results for {current_patient_name}")
        else:
            print(f"🔹 No specific results found for {current_patient_name}, using all {len(merged)} results")

    print(f"🔹 Total merged results: {len(merged)}")
    return merged, processed_query
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
    print("Extracted highlight:", highlight)
    return highlight.strip()

def update_patient_context(question: str, session_id: str) -> str:
    """Update patient context and resolve pronouns."""
    # Extract patient names from current question
    patient_names = extract_patient_names(question)
    
    # Update current patient if new name found
    if patient_names:
        current_patient[session_id] = patient_names[0]
        print(f"Updated patient context for session {session_id}: {patient_names[0]}")
    
    # Get current patient for this session
    patient = current_patient.get(session_id)
    
    if patient:
        # Comprehensive pronoun resolution
        pronoun_patterns = [
            (r"\bhis\b", f"{patient}'s"),
            (r"\bher\b", f"{patient}'s"),
            (r"\btheir\b", f"{patient}'s"),
            (r"\bhe\b", patient),
            (r"\bshe\b", patient),
            (r"\bthey\b", patient),
            (r"\bhim\b", patient),
            (r"\bthem\b", patient),
            (r"\bthe patient\b", patient),
            (r"\bthis patient\b", patient)
        ]
        
        for pattern, replacement in pronoun_patterns:
            question = re.sub(pattern, replacement, question, flags=re.IGNORECASE)
    
    return question

def get_patient_context(session_id: str) -> Optional[str]:
    """Get current patient for session."""
    return current_patient.get(session_id)


def generate_answer_with_sources(question, contexts, session_id="default", processed_query=None):
    # Use processed query if available, otherwise process the question
    if processed_query is None:
        processed_query = update_patient_context(question, session_id)
    
    # --- Get last chat history for this session ---
    memory_context = get_memory_context(session_id, max_turns=5)
    
    # --- Get current patient context ---
    current_patient_name = get_patient_context(session_id)
    patient_context = f"\nCurrent patient in conversation: {current_patient_name}" if current_patient_name else ""

    # --- Build context text ---
    context_text = "\n\n".join([c["text"] for c in contexts])

    # --- Build final prompt including chat history and patient context ---
    prompt = f"""You are a medical assistant.
Use the following patient records, knowledge base, and the conversation history
to answer the question clearly and accurately. 
If the answer is not in the records, say so.{patient_context}

Conversation History:
{memory_context}

Context:
{context_text}

Original Question: {question}
Processed Question: {processed_query}

Answer:"""

    # --- Call LLM ---
    response = bedrock.invoke_model(
        modelId=LLM_MODEL,
        body=json.dumps({
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": 1500, "temperature": 0.2, "topP": 0.9}
        })
    )
    resp_body = json.loads(response["body"].read())
    answer = resp_body["output"]["message"]["content"][0]["text"]

    # --- Save Q&A into memory ---
    add_to_memory(session_id, "user", question)
    add_to_memory(session_id, "assistant", answer)

    # --- Extract sources + highlights using processed query ---
    sources = []
    seen = {}
    for c in contexts:
        hl = extract_highlight(processed_query, c["text"]) or ""
        norm = hl.strip().lower()
        if not norm or "n/a" in norm:
            continue

        raw = c.get("source") or c.get("s3_key") or c.get("file") or ""
        key = normalize_s3_key(raw)
        if not key:
            continue

        # choose presigned (private bucket) or public
        url = build_presigned_get(key, ttl_sec=600)
        page = c.get("page")
        if page:
            url = f"{url}#page={page}"

        file_name = c.get("file") or key.split("/")[-1]
        dedup_key = (key, page)

        if dedup_key not in seen:
            seen[dedup_key] = {
                "file": file_name,
                "page": page,
                "key": key,
                "url": url,
                "highlight": set()
            }

        if hl.strip():
            seen[dedup_key]["highlight"].add(hl.strip())

    for entry in seen.values():
        entry["highlight"] = list(entry["highlight"])
        sources.append(entry)

    return answer, sources




# -------------------------------
# Main
# -------------------------------
if __name__ == "__main__":
    session_id = "test_session"
    while True:
        q = input("Ask Anything> ")
        if q.lower() in ['quit', 'exit']:
            break
        if q.lower() == 'reset':
            reset_memory(session_id)
            current_patient.pop(session_id, None)
            print("Session reset.")
            continue
            
        contexts, processed_q = hybrid_search(q, session_id=session_id, top_k=5)
        print("🔍 Retrieved Contexts:")
        for c in contexts:
            print("-", c["text"][:200], "...")

        answer, sources = generate_answer_with_sources(q, contexts, session_id, processed_q)

        print("\n🤖 Nova Pro Answer:\n", answer)
        print("\n📚 Sources:")
        for s in sources:
            print(f"- {s['key']} (Page {s['page']})")
            print(f"  🔎 Highlight: {s['highlight']}\n")
        
        current_patient_name = get_patient_context(session_id)
        if current_patient_name:
            print(f"\n👤 Current patient: {current_patient_name}")
