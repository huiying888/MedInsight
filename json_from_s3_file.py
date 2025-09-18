import boto3
import fitz  # PyMuPDF for PDF parsing
import pytesseract
from PIL import Image
import io
import json
import re
import uuid
import os

# -------------------------------
# Configs
# -------------------------------

# Configs 
AWS_REGION = "us-east-1" 
S3_BUCKET = "medicalbucket1249832761249837462" 
S3_KEY = "docs/Patient Data 1.pdf"

# -------------------------------
# Initialize boto3 client (auto loads creds from env/credentials file)
# -------------------------------
s3 = boto3.client("s3", region_name=AWS_REGION)

def download_from_s3(bucket, key):
    """Download file from S3 to a unique local path."""

    # Use the base name of the key + a random UUID
    base_name = os.path.basename(key)
    local_path = f"{uuid.uuid4().hex}_{base_name}"
    
    s3.download_file(bucket, key, local_path)
    return local_path


# -------------------------------
# Grouping function
# -------------------------------
def group_lines_to_chunks(lines, x_threshold=0.03, y_threshold=0.02,
                          max_chars=1500, overlap=100, min_size=1000, source=None):
    """
    Group lines into chunks with fewer splits.
    - Prioritizes y-axis (vertical alignment) before x-axis (horizontal shift).
    - Splits are word-safe (only on whitespace).
    - Small groups are merged into previous buffer.
    """
    chunks = []
    cur = []
    last_top = None
    last_page = None
    last_right = None

    for ln in lines:
        print(ln)
        if not cur:
            cur.append(ln)
            last_top = ln["bbox"][1]
            last_right = ln["bbox"][2]
            last_page = ln["page"]
            continue

        # Always split if page changes
        if ln["page"] != last_page:
            chunks.append(cur)
            cur = [ln]

        # Prioritize vertical distance first
        elif abs(ln["bbox"][1] - last_top) > y_threshold:
            chunks.append(cur)
            cur = [ln]

        # Only check horizontal gap if vertical is close enough
        elif abs(ln["bbox"][0] - last_right) > x_threshold:
            chunks.append(cur)
            cur = [ln]

        else:
            cur.append(ln)

        last_top = ln["bbox"][1]
        last_right = ln["bbox"][2]
        last_page = ln["page"]

    if cur:
        chunks.append(cur)

    structured_chunks = []
    buffer = None

    for group in chunks:
        text = " ".join(l["text"] for l in group if l["text"])
        print(text)
        if not text.strip():
            continue

        # Merge small groups into previous buffer
        if buffer and len(buffer["text"]) < min_size:
            buffer["text"] += " " + text
            buffer["bbox"]["bottom"] = max(
                buffer["bbox"]["bottom"], max(l["bbox"][3] for l in group)
            )
            continue

        buffer = {
            "text": text,
            "page": group[0]["page"],
            "bbox": {
                "left": min(l["bbox"][0] for l in group),
                "top": min(l["bbox"][1] for l in group),
                "right": max(l["bbox"][2] for l in group),
                "bottom": max(l["bbox"][3] for l in group)
            },
            "source": f"{source}#page={group[0]['page']}" if source else None
        }

        # Split long chunks with overlap (word-safe)
        if len(buffer["text"]) > max_chars:
            start = 0
            while start < len(buffer["text"]):
                end = min(start + max_chars, len(buffer["text"]))
                if end < len(buffer["text"]):
                    while end > start and not buffer["text"][end].isspace():
                        end -= 1
                part = buffer["text"][start:end].strip()
                if part:
                    structured_chunks.append({**buffer, "text": part})
                if end >= len(buffer["text"]):
                    break
                start = end - overlap
        else:
            structured_chunks.append(buffer)

    return structured_chunks

# -------------------------------
# OCR for images
# -------------------------------
def extract_text_from_image(path):
    image = Image.open(path)
    ocr_data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

    lines = []
    for i in range(len(ocr_data["text"])):
        if int(ocr_data["conf"][i]) > 0:  # skip empty / low confidence
            lines.append({
                "text": ocr_data["text"][i],
                "page": 1,
                "bbox": (
                    ocr_data["left"][i],
                    ocr_data["top"][i],
                    ocr_data["left"][i] + ocr_data["width"][i],
                    ocr_data["top"][i] + ocr_data["height"][i],
                ),
            })
    return lines

# -------------------------------
# PDF extraction (if input is PDF)
# -------------------------------
def extract_text_from_pdf(path):
    doc = fitz.open(path)
    lines = []
    for page_num, page in enumerate(doc, start=1):
        for b in page.get_text("blocks"):
            text, bbox = b[4], b[:4]
            if text.strip():
                print(text.strip())
                lines.append({
                    "text": text.strip(),
                    "page": page_num,
                    "bbox": bbox
                })
    return lines

import re
import os

def get_json_from_s3_file(s3_folder, s3_file):
    S3_KEY = f"{s3_folder}/{s3_file}"
    local_file = download_from_s3(S3_BUCKET, S3_KEY)

    try:
        if local_file.lower().endswith(".pdf"):
            lines = extract_text_from_pdf(local_file)
        else:
            lines = extract_text_from_image(local_file)

        chunks = group_lines_to_chunks(lines, source=f"s3://{S3_BUCKET}/{S3_KEY}")

        # -------------------------------
        # Prepare JSON object (list of dicts)
        # -------------------------------
        json_chunks = []
        for idx, ch in enumerate(chunks):
            json_chunks.append({
                "chunk_id": idx,
                "page": ch["page"],
                "text": ch["text"],
                "source": ch["source"],
                "type": f"{s3_folder}"
            })

        return json_chunks

    finally:
        # -------------------------------
        # Clean up temporary file
        # -------------------------------
        if os.path.exists(local_file):
            os.remove(local_file)
            print(f"Deleted temporary file {local_file}")

# -------------------------------
# Example Usage
# -------------------------------
if __name__ == "__main__":
    folder = "guidelines"
    file = "MOH_GUIDELINE_FINAL_BOOK_EBOOK_SINGLE_compressed.pdf"
    json_data = get_json_from_s3_file(folder, file)
    
    output_file = f"{os.path.splitext(os.path.basename(file))[0]}.json"  # You can change the filename
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=4)

    # Convert JSON data to string
    json_str = json.dumps(json_data, ensure_ascii=False, indent=4)

    s3_output_key = f"output_{folder}/{output_file}" # Change to whatever the folder name you want

    # Upload JSON to S3
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=s3_output_key,
        Body=json_str.encode("utf-8"),
        ContentType="application/json"
    )

    print(f"Saved {len(json_data)} items to {output_file}")

