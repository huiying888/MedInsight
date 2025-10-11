import re
from collections import defaultdict
from json_from_s3_file import download_from_s3
import os
import json
import boto3
from json_from_s3_file import s3
from threading import Lock
s3_lock = Lock()

BUCKET = os.getenv("AWS_BUCKET", "meddoc-raw")
REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
S3_BUCKET = "meddoc-processed"
PROCESSED_BUCKET = "meddoc-structured"

# s3 = boto3.client(
#     "s3",
#     region_name=REGION,
#     aws_access_key_id=AWS_ACCESS_KEY_ID,
#     aws_secret_access_key=AWS_SECRET_ACCESS_KEY
# )

def clean_value(val: str) -> str:
    val = re.split(
        r"(SECTION|Full name of doctor|Diagnosis|Age of patient|Allergies|MCR|NRIC / MyKad no.)",
        val,
        maxsplit=1,
    )[0]
    return val.strip()

def parse_chunks(chunks):
    patient_data = defaultdict(dict)

    for chunk in chunks:
        text = chunk.get("text", "")

        if match := re.search(r"Full name of patient\s*\n?([^\n]+)", text):
            patient_data["name"] = clean_value(match.group(1))
        if match := re.search(r"NRIC / MyKad no\.\s*\n?([^\n]+)", text):
            patient_data["nric"] = clean_value(match.group(1))
        if match := re.search(r"Age of patient\s*\n?(\d+)", text):
            patient_data["age"] = int(match.group(1))
        if match := re.search(r"Gender\s*\n?(Male|Female)", text):
            patient_data["gender"] = match.group(1)
        if match := re.search(r"Blood type\s*\n?([^\n]+)", text):
            patient_data["blood_type"] = clean_value(match.group(1))
        if match := re.search(r"Allergies\s*\n?([^\n]+)", text):
            patient_data["allergies"] = clean_value(match.group(1))
        if match := re.search(r"Full name of doctor\s*\n?([^\n]+)", text):
            patient_data["doctor"] = clean_value(match.group(1))
        if "Diagnosis" in text:
            diags = re.findall(r"\d+\.\s*([^\n]+)", text)
            if diags:
                patient_data["diagnoses"] = [clean_value(d) for d in diags]
        if match := re.search(r"(\d{1,2} [A-Za-z]+ \d{4})", text):
            patient_data["date"] = match.group(1)

    return dict(patient_data)

def get_chunks_from_s3_file(s3_folder, s3_file):
    """
    Downloads JSON chunks from S3, parses them with parse_chunks,
    and returns structured patient data.
    """
    S3_KEY = f"{s3_folder}/{s3_file}"
    print(f"Processing s3://{S3_BUCKET}/{S3_KEY}")
    local_file = download_from_s3(S3_BUCKET, S3_KEY)
    print(f"Downloaded {S3_KEY} to {local_file}")

    try:
        # Read JSON chunks
        with open(local_file, "r", encoding="utf-8") as f:
            chunks = json.load(f)

        print(f"Loaded {len(chunks)} chunks from {local_file}")

        structured_data = parse_chunks(chunks)

        # Ensure it's always a list
        if isinstance(structured_data, dict):
            structured_data = [structured_data]

        for patient in structured_data:
            patient["source_file"] = s3_file

        return structured_data

    except Exception as e:
        print(f"Error processing file: {e}")
        raise

    finally:
        if os.path.exists(local_file):
            os.remove(local_file)
            print(f"Deleted temporary file {local_file}")

# -------------------------------
# Upload JSON to S3 with NRIC deduplication
# -------------------------------
def upload_structured_to_s3(json_data, folder):
    """
    Uploads json_data to S3 in the given folder with the fixed name
    'patients_structured.json'. Appends to existing data if present.
    Skips new patients if NRIC already exists.
    """
    with s3_lock:
        s3_key = f"{folder}/patients_structured.json"
        combined_data = []

        # Check if file exists
        try:
            existing_obj = s3.get_object(Bucket=PROCESSED_BUCKET, Key=s3_key)
            existing_data = json.loads(existing_obj['Body'].read())
            if isinstance(existing_data, list):
                combined_data.extend(existing_data)
        except s3.exceptions.NoSuchKey:
            # File does not exist, create new
            pass

        # Collect existing NRICs for deduplication
        existing_nrics = {p.get("nric") for p in combined_data}

        # Append new data only if NRIC not already in combined_data
        # Always normalize input to a list
        if not isinstance(json_data, list):
            json_data = [json_data]

        for patient in json_data:
            if patient.get("nric") not in existing_nrics:
                combined_data.append(patient)
                existing_nrics.add(patient.get("nric"))

        # Upload combined JSON back to S3
        s3.put_object(
            Bucket=PROCESSED_BUCKET,
            Key=s3_key,
            Body=json.dumps(combined_data, ensure_ascii=False, indent=4).encode("utf-8"),
            ContentType="application/json"
        )

        return s3_key
