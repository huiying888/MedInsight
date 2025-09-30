import boto3
import fitz  # PyMuPDF for PDF parsing
import pytesseract
from PIL import Image
import io
import json
import re
import uuid
import os
import convert_to_pdf as PdfConverter
import shutil
from pathlib import Path

# -------------------------------
# Configs
# -------------------------------

RAW_BUCKET = "meddoc-raw"
PROCESSED_BUCKET = "meddoc-processed"

# -------------------------------
# Initialize boto3 client
# -------------------------------

Path("tmp").mkdir(exist_ok=True)
s3 = boto3.client("s3")
converter = PdfConverter.FileConverter(None, "tmp/pdf")

# comprehend_medical = boto3.client("comprehendmedical", region_name="us-east-1")  # Only in us-east-1

def download_from_s3(bucket, key):
    """Download file from S3 to a unique local path."""
    print("downloading from s3")

    # Use the base name of the key + a random UUID
    base_name = os.path.basename(key)
    local_path = f"{uuid.uuid4().hex}_{base_name}"
    
    s3.download_file(bucket, key, local_path)
    print(f"Downloaded s3://{bucket}/{key} to {local_path}")
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
        # --- Extract native text blocks ---
        for b in page.get_text("blocks"):
            text, bbox = b[4], b[:4]
            if text.strip():
                lines.append({
                    "text": text.strip(),
                    "page": page_num,
                    "bbox": bbox  # already in page coords
                })

        # --- Extract images + run OCR ---
        for img_info in page.get_image_info(xrefs=True):
            xref = img_info["xref"]
            image_bbox = img_info["bbox"]  # already in page coords

            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                pil_img = Image.open(io.BytesIO(image_bytes))
            except Exception as e:
                print(f"⚠ Could not extract image xref={xref} on page {page_num}: {e}")
                continue

            img_w, img_h = pil_img.size

            # Run OCR
            ocr_data = pytesseract.image_to_data(
                pil_img, output_type=pytesseract.Output.DICT
            )

            for i in range(len(ocr_data["text"])):
                if int(ocr_data["conf"][i]) > 0 and ocr_data["text"][i].strip():
                    x, y, w, h = (ocr_data["left"][i],
                                  ocr_data["top"][i],
                                  ocr_data["width"][i],
                                  ocr_data["height"][i])

                    # Scale OCR bbox → page coords
                    x0_page = image_bbox[0] + (x / img_w) * (image_bbox[2] - image_bbox[0])
                    y0_page = image_bbox[1] + (y / img_h) * (image_bbox[3] - image_bbox[1])
                    x1_page = image_bbox[0] + ((x + w) / img_w) * (image_bbox[2] - image_bbox[0])
                    y1_page = image_bbox[1] + ((y + h) / img_h) * (image_bbox[3] - image_bbox[1])

                    lines.append({
                        "text": ocr_data["text"][i],
                        "page": page_num,
                        "bbox": (x0_page, y0_page, x1_page, y1_page)
                    })

    return lines


def extract_image_from_pdf(path, output_dir):
    doc = fitz.open(path)

    # Ensure output folder exists
    os.makedirs(output_dir, exist_ok=True)

    for page_num in range(len(doc)):
        page = doc[page_num]
        images = page.get_images(full=True)

        for img_index, img in enumerate(images, start=1):
            xref = img[0]  # image reference ID
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            image_ext = base_image["ext"]

            bbox = page.get_image_bbox(xref)

            img_filename = f"page{page_num+1}_img{img_index}.{image_ext}"
            img_path = os.path.join(output_dir, img_filename)

            with open(img_path, "wb") as f:
                f.write(image_bytes)


def get_json_from_s3_file(s3_folder, s3_file):
    S3_KEY = f"{s3_folder}/{s3_file}"
    print(f"Processing s3://{RAW_BUCKET}/{S3_KEY}")
    local_file = download_from_s3(RAW_BUCKET, S3_KEY)
    print(f"Downloaded {S3_KEY} to {local_file}")
    try:
        # if not pdf, convert to pdf
        if not local_file.lower().endswith(".pdf"):
            converter.convert_file(local_file)
            temp_file = "tmp/pdf/" + os.path.splitext(local_file)[0] + ".pdf"
        else:
            temp_file = "tmp/pdf/" + local_file

        # Lines Extraction from Texts and Images in PDF
        lines = extract_text_from_pdf(temp_file)

        chunks = group_lines_to_chunks(lines, source=f"s3://{RAW_BUCKET}/{S3_KEY}")
        print(f"Extracted {len(chunks)} chunks from {temp_file}")

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
                "bbox": ch["bbox"],
                "type": f"{s3_folder}"
            })
        print(f"Prepared {len(json_chunks)} JSON chunks")

        return json_chunks
    except Exception as e:
        print(f"Error processing file: {e}")
        raise

    finally:
        # -------------------------------
        # Clean up temporary file
        # -------------------------------
        if os.path.exists(local_file):
            os.remove(local_file)
            print(f"Deleted temporary file {local_file}")
        if os.path.exists(temp_file):
            os.remove(temp_file)
            print(f"Deleted temporary file {temp_file}")
        if os.path.exists("tmp"):
            shutil.rmtree("tmp")
            print('Deleted temporary folder "tmp"')

# def process_patient_with_comprehend(chunks):
#     """Run Comprehend Medical on extracted chunks of patient data."""
#     results = []
#     for ch in chunks:
#         try:
#             resp = comprehend_medical.detect_entities_v2(Text=ch["text"])
#             entities = resp.get("Entities", [])
#             results.append({
#                 "chunk_id": ch["chunk_id"],
#                 "page": ch["page"],
#                 "text": ch["text"],
#                 "entities": entities,
#                 "source": ch["source"],
#                 "type": ch["type"]
#             })
#         except Exception as e:
#             print(f"ComprehendMedical failed: {e}")
#             results.append(ch)  # fallback
#     return results

# -------------------------------
# Upload JSON to S3
# -------------------------------
def upload_json_to_s3(json_data, folder, file_name):
    """
    Uploads json_data to S3 with a unique name in the given folder.
    Returns the S3 key of the uploaded file.
    """
    try:
        # Generate a unique output file name
        output_file = f"{os.path.splitext(os.path.basename(file_name))[0]}.json"
        s3_key = f"{folder}/{output_file}"

        # Convert to JSON string
        json_str = json.dumps(json_data, ensure_ascii=False, indent=4)

        # Upload to S3
        s3.put_object(
            Bucket=PROCESSED_BUCKET,
            Key=s3_key,
            Body=json_str.encode("utf-8"),
            ContentType="application/json"
        )
    except Exception as e:
        print(f"Error uploading JSON to S3: {e}")
        raise

    return s3_key

# -------------------------------
# Example Usage
# -------------------------------
if __name__ == "__main__":
    folder = "knowledge"
    file = "medicine.png"
    json_data = get_json_from_s3_file(folder, file)
    
    # output_file = f"{os.path.splitext(os.path.basename(file))[0]}.json"  # You can change the filename
    
    # with open(output_file, "w", encoding="utf-8") as f:
    #     json.dump(json_data, f, ensure_ascii=False, indent=4)

    # # Convert JSON data to string
    # json_str = json.dumps(json_data, ensure_ascii=False, indent=4)

    # s3_output_key = f"output_{folder}/{output_file}" # Change to whatever the folder name you want

    # # Upload JSON to S3
    # s3.put_object(
    #     Bucket=RAW_BUCKET,
    #     Key=s3_output_key,
    #     Body=json_str.encode("utf-8"),
    #     ContentType="application/json"
    # )

    output_file = f"{uuid.uuid4().hex}_{os.path.splitext(os.path.basename(file))[0]}.json"
    PROCESSED_BUCKET = "meddoc-processed"
    s3_output_key = f"{folder}/{output_file}"

    json_str = json.dumps(json_data, ensure_ascii=False, indent=4)
    s3.put_object(
        Bucket=PROCESSED_BUCKET,
        Key=s3_output_key,
        Body=json_str.encode("utf-8"),
        ContentType="application/json"
    )

    print(f"Saved {len(json_data)} items to {output_file}")


