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
# Query FAISS (local only)
# -------------------------------
def query_faiss(question, k=3):
    # Load local FAISS index + metadata
    if not os.path.exists(INDEX_FILE) or not os.path.exists(META_FILE):
        raise FileNotFoundError("❌ FAISS index or metadata not found locally. Please build the index first.")

    index = faiss.read_index(INDEX_FILE)
    with open(META_FILE, "r") as f:
        metadata = json.load(f)

    # Embed query and search
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
    """Extract patient names using NLP entity recognition only."""
    doc = nlp(query)
    names = []
    
    # Use only NLP's PERSON entity recognition
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            # Additional validation: check if it's actually a person name
            name = ent.text.strip()
            # Remove possessive 's from names
            name = name.rstrip("'s")
            # Skip single words that are likely medical terms
            if len(name.split()) >= 2 or name[0].isupper():
                names.append(name)
    
    # Remove duplicates while preserving order
    unique_names = []
    for name in names:
        if name.lower() not in [n.lower() for n in unique_names]:
            unique_names.append(name)
    
    print("Patient names detected:", unique_names)
    return unique_names

def extract_keywords(query):
    """Extract general keywords for search using NLP."""
    doc = nlp(query)
    keywords = []
    
    # Extract patient names
    patient_names = extract_patient_names(query)
    keywords.extend(patient_names)
    
    # Extract meaningful words using NLP (nouns, proper nouns, adjectives)
    for token in doc:
        if (not token.is_stop and not token.is_punct and len(token.text) > 2 and 
            token.pos_ in ['NOUN', 'PROPN', 'ADJ'] and token.text.lower() not in [name.lower() for name in patient_names]):
            keywords.append(token.text)
    
    # Extract named entities
    for ent in doc.ents:
        if ent.label_ in ["ORG", "GPE", "DATE", "CARDINAL", "PRODUCT"]:
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

def hybrid_search(query, session_id="default", top_k=None, keyword_hits=10):
    """Dynamic search with patient context awareness."""
    # Clear patient context for general medical questions FIRST
    original_patient_names = extract_patient_names(query)
    pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
    query_words = query.lower().split()
    has_pronouns = any(pronoun in query_words for pronoun in pronouns)
    
    print(f"DEBUG CLEAR: names={original_patient_names}, pronouns={has_pronouns}, session_in_patient={session_id in current_patient}")
    
    if not original_patient_names and not has_pronouns and session_id in current_patient:
        print(f"🔄 Clearing patient context for general query: {query}")
        del current_patient[session_id]
    
    # Update patient context and resolve pronouns
    processed_query = update_patient_context(query, session_id)
    
    # Dynamically set top_k if not provided
    if top_k is None:
        top_k = 15 if len(processed_query.split()) <= 3 else 10

    # Use processed query for FAISS search
    faiss_results = query_faiss(processed_query, k=top_k)
    
    # Extract keywords from processed query
    keywords = extract_keywords(processed_query)
    keyword_results = []
    for keyword in keywords:
        keyword_results.extend(keyword_search(keyword, max_hits=keyword_hits))

    # Merge results using text-based deduplication
    seen_texts = set()
    merged = []
    
    # Add FAISS results first
    for r in faiss_results:
        text_key = r["text"][:100].lower()  # Use first 100 chars as key
        if text_key not in seen_texts:
            seen_texts.add(text_key)
            merged.append(r)
    
    # Add keyword results
    for r in keyword_results:
        text_key = r["text"][:100].lower()
        if text_key not in seen_texts:
            seen_texts.add(text_key)
            merged.append(r)

    # Filter by current patient ONLY if the query is patient-specific
    original_patient_names = extract_patient_names(query)  # Check original query, not processed
    pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
    has_pronouns = any(pronoun in query.lower() for pronoun in pronouns)
    
    # Only filter by patient if the query explicitly mentions patients or uses pronouns
    if original_patient_names or has_pronouns:
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
                # If no patient-specific results found, return empty list to indicate no data
                print(f"🔹 No records found for {current_patient_name}")
                merged = []

    print(f"🔹 Total merged results: {len(merged)}")
    print(f"👤 Current patient context: {get_patient_context(session_id)}")
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

def is_related_to_previous_context(current_question: str, session_id: str) -> bool:
    """Check if current question is related to previous conversation."""
    if session_id not in chat_memory or len(chat_memory[session_id]) == 0:
        return False
    
    # Get last few exchanges
    recent_history = chat_memory[session_id][-4:]  # Last 2 Q&A pairs
    history_text = " ".join([msg["content"] for msg in recent_history]).lower()
    
    # Extract keywords from current question and history
    current_doc = nlp(current_question.lower())
    history_doc = nlp(history_text)
    
    # Get meaningful words (nouns, adjectives, medical terms)
    current_keywords = set()
    for token in current_doc:
        if (not token.is_stop and not token.is_punct and len(token.text) > 3 and 
            token.pos_ in ['NOUN', 'ADJ', 'PROPN']):
            current_keywords.add(token.lemma_)
    
    history_keywords = set()
    for token in history_doc:
        if (not token.is_stop and not token.is_punct and len(token.text) > 3 and 
            token.pos_ in ['NOUN', 'ADJ', 'PROPN']):
            history_keywords.add(token.lemma_)
    
    # Check overlap
    if len(current_keywords) == 0 or len(history_keywords) == 0:
        return False
    
    overlap = len(current_keywords & history_keywords)
    overlap_ratio = overlap / min(len(current_keywords), len(history_keywords))
    
    # Consider related if >30% keyword overlap AND current question has patient-specific indicators
    patient_indicators = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them', 'patient']
    has_patient_indicators = any(indicator in current_question.lower() for indicator in patient_indicators)
    
    # Only consider related if there's overlap AND the question seems patient-specific
    is_related = overlap_ratio > 0.3 and has_patient_indicators
    print(f"🔗 Context relation check: {overlap_ratio:.2f} overlap, patient_indicators={has_patient_indicators} - {'Related' if is_related else 'Unrelated'}")
    
    return is_related

def update_patient_context(question: str, session_id: str) -> str:
    """Update patient context and resolve pronouns."""
    # Extract patient names from current question
    patient_names = extract_patient_names(question)
    
    # Check if current question is related to previous context
    if not is_related_to_previous_context(question, session_id):
        # Clear chat history for unrelated questions
        if session_id in chat_memory and len(chat_memory[session_id]) > 0:
            print(f"🔄 Clearing chat history - unrelated topic detected")
            chat_memory[session_id] = []
        
        # Clear patient context for unrelated questions ONLY if no pronouns in current question
        pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
        has_pronouns = any(pronoun in question.lower() for pronoun in pronouns)
        
        if not has_pronouns and session_id in current_patient:
            print(f"🔄 Clearing patient context - unrelated topic")
            del current_patient[session_id]
    
    # Update current patient if new name found
    if patient_names:
        current_patient[session_id] = patient_names[0]
        print(f"Updated patient context for session {session_id}: {patient_names[0]}")
    elif not patient_names:
        # Check if question has pronouns or patient-specific terms
        pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
        patient_terms = ['patient', 'this patient', 'the patient']
        
        has_pronouns = any(pronoun in question.lower() for pronoun in pronouns)
        has_patient_terms = any(term in question.lower() for term in patient_terms)
        
        # Clear patient context for general medical questions
        if not has_pronouns and not has_patient_terms:
            if session_id in current_patient:
                print(f"🔄 Clearing patient context - general query detected")
                del current_patient[session_id]
    
    # Additional check: if question is unrelated AND has no patient names/pronouns, clear patient context
    if not is_related_to_previous_context(question, session_id):
        pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
        has_pronouns = any(pronoun in question.lower() for pronoun in pronouns)
        if not patient_names and not has_pronouns and session_id in current_patient:
            print(f"🔄 Force clearing patient context - unrelated general query")
            del current_patient[session_id]
    
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


def generate_query_suggestions(session_id="default", contexts=None):
    """Generate 4 relevant follow-up questions based on patient context and conversation history."""
    current_patient_name = get_patient_context(session_id)
    memory_context = get_memory_context(session_id, max_turns=3)
    
    # Only use valid patient names (not processed queries)
    valid_patient = None
    if current_patient_name and len(current_patient_name.split()) <= 4 and not any(word in current_patient_name.lower() for word in ['allergy', 'has', 'to', 'penicillin']):
        valid_patient = current_patient_name
    
    # Build context for suggestions - focus on general medical topics from conversation
    recent_topics = []
    if memory_context:
        # Extract medical topics from recent conversation
        if 'allergy' in memory_context.lower():
            recent_topics.append('allergies')
        if 'penicillin' in memory_context.lower():
            recent_topics.append('antibiotic allergies')
    
    topic_context = f"Recent topics discussed: {', '.join(recent_topics)}" if recent_topics else "General medical inquiry"
    patient_info = f"Current patient: {valid_patient}" if valid_patient else "Multiple patients discussed"
    
    # Get the last question to avoid repeating it
    last_question = ""
    if memory_context:
        lines = memory_context.split('\n')
        for line in reversed(lines):
            if line.startswith('User:'):
                last_question = line.replace('User:', '').strip()
                break
    
    prompt = f"""Generate 4 NEW and DIFFERENT medical follow-up questions based on the conversation context. Do NOT repeat the question that was just asked. Focus on related but different medical topics.

{patient_info}
{topic_context}

Last question asked: {last_question}

Generate 4 DIFFERENT follow-up questions (one per line, no numbering):"""

    try:
        response = bedrock.invoke_model(
            modelId=LLM_MODEL,
            body=json.dumps({
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {"maxTokens": 200, "temperature": 0.7, "topP": 0.9}
            })
        )
        resp_body = json.loads(response["body"].read())
        suggestions_text = resp_body["output"]["message"]["content"][0]["text"]
        
        # Parse and clean suggestions
        suggestions = []
        for line in suggestions_text.split('\n'):
            line = line.strip()
            if line and not line.startswith('-') and '?' in line:
                # Remove any specific patient names that might be hallucinated
                line = re.sub(r'\b[A-Z][a-z]+ [A-Z][a-z]+\b', 'the patient', line)
                
                # Skip if too similar to the last question
                if last_question and len(set(line.lower().split()) & set(last_question.lower().split())) > 3:
                    continue
                    
                suggestions.append(line)
        
        # Take first 4 unique suggestions
        unique_suggestions = []
        for s in suggestions:
            if s not in unique_suggestions:
                unique_suggestions.append(s)
        suggestions = unique_suggestions[:4]
        
        # If we don't have 4, add generic ones
        while len(suggestions) < 4:
            generic = [
                "What are the latest test results?",
                "Show me the medication history",
                "What are the vital signs trends?",
                "Are there any recent diagnoses?"
            ]
            for g in generic:
                if g not in suggestions:
                    suggestions.append(g)
                    break
        
        return suggestions[:4]
    except Exception as e:
        print(f"Error generating suggestions: {e}")
        return [
            "What are the latest test results?",
            "Show me the medication history", 
            "What are the vital signs trends?",
            "Are there any recent diagnoses?"
        ]

def generate_answer_with_sources(question, contexts, session_id="default", processed_query=None):
    # Use processed query if available, otherwise process the question
    if processed_query is None:
        processed_query = update_patient_context(question, session_id)
    
    # Check if we have any relevant context
    if not contexts or len(contexts) == 0:
        # Check if this is a general medical question or patient-specific
        patient_names_in_question = extract_patient_names(question)
        pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
        question_words = question.lower().split()
        has_pronouns = any(pronoun in question_words for pronoun in pronouns)
        
        print(f"DEBUG: patient_names_in_question={patient_names_in_question}, has_pronouns={has_pronouns}")
        
        # Only return patient-specific error if the question explicitly mentions patients or uses pronouns
        if patient_names_in_question or has_pronouns:
            current_patient_name = get_patient_context(session_id)
            patient_name = current_patient_name or (patient_names_in_question[0] if patient_names_in_question else "unknown patient")
            return f"No records found for patient '{patient_name}'. Please verify the patient name is correct.", [], []
        else:
            # For general medical questions, provide general medical information
            print(f"DEBUG: Generating general medical answer for: {question}")
            general_answer = generate_general_medical_answer(question)
            return general_answer, [], []
    
    # Check if asking about specific patient but no patient-specific records found
    current_patient_name = get_patient_context(session_id)
    original_patient_names = extract_patient_names(question)
    pronouns = ['his', 'her', 'their', 'he', 'she', 'they', 'him', 'them']
    question_words = question.lower().split()
    has_pronouns = any(pronoun in question_words for pronoun in pronouns)
    
    # Only check for patient-specific records if the question is actually about a specific patient
    if current_patient_name and (original_patient_names or has_pronouns) and not any(current_patient_name.lower() in c["text"].lower() for c in contexts):
        return f"No records found for patient '{current_patient_name}'. Please verify the patient name is correct.", [], []
    
    # --- Get last chat history for this session ---
    memory_context = get_memory_context(session_id, max_turns=5)
    
    patient_context = f"\nCurrent patient in conversation: {current_patient_name}" if current_patient_name else ""

    # --- Build context text ---
    context_text = "\n\n".join([c["text"] for c in contexts])

    # --- Build final prompt including chat history and patient context ---
    prompt = f"""You are a medical assistant.
Use the following patient records, knowledge base, guidelines and the conversation history
to answer the question clearly and accurately. 

IMPORTANT: Carefully review ALL patient records provided in the context. Make sure to identify ALL patients that match the criteria in the question.

1. FIRST: Check if the answer to the question can be found in the provided knowledge base and patient records.
2. IF NOT FOUND: Start your response with "This information is not available in our knowledge base." then provide general medical information
If the answer is not in the records, say so.{patient_context}

Conversation History:
{memory_context}

Context:
{context_text}

Original Question: {question}
Processed Question: {processed_query}

Answer (make sure to include ALL relevant patients from the context):"""

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

    # --- Generate suggestions ---
    suggestions = generate_query_suggestions(session_id, contexts)

    return answer, sources, suggestions




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

        answer, sources, suggestions = generate_answer_with_sources(q, contexts, session_id, processed_q)

        print("\n🤖 Nova Pro Answer:\n", answer)
        print("\n📚 Sources:")
        for s in sources:
            print(f"- {s['key']} (Page {s['page']})")
            print(f"  🔎 Highlight: {s['highlight']}\n")
        
        print("\n💡 Suggested Questions:")
        for i, suggestion in enumerate(suggestions, 1):
            print(f"{i}. {suggestion}")
        
        current_patient_name = get_patient_context(session_id)
        if current_patient_name:
            print(f"\n👤 Current patient: {current_patient_name}")
