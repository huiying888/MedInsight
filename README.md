# MedInsight

![MedInsight](assets/medinsight-photo.png)

**MedInsight** is an AI-powered **medical document intelligence system** that helps healthcare professionals instantly **search, summarize, and analyze** unstructured clinical data — from PDFs, DOCX, PPT, CSV, or scanned medical images.  

By combining **OCR**, **Natural Language Processing (NLP)**, and **Generative AI**, MedInsight enables clinicians to **ask questions in plain language**, view **AI summaries of patient records**, and access **interactive dashboards** that visualize medical insights — all from one centralized platform.

---
## Table of Contents

- [Problem Statement](#problem-statement-ai-driven-automation-for-business-growth)
- [Solution](#solution)
- [Tech Stack](#tech-stack)
- [Setup Instructions](#setup-instructions)
- [Reflection](#reflection)
- [License](#license)

---
## Problem Statement: AI-Powered Medical Document Query Tool
Healthcare professionals in Malaysia face the challenge of:  
- Critical patient data and clinical guidelines buried in unstructured documents.  
- Manual searches that are time-consuming and error-prone.  
- Difficulty extracting accurate insights from scanned, legacy, or complex medical documents.

---

## Solution

**MedInsight** solves these problems through an **AI-driven, all-in-one medical document platform** that enables clinicians to:
1. **Search** any document through natural conversation.  
2. **Summarize** patient records with AI.  
3. **Visualize** insights on an analytics dashboard.  
4. **Upload and process** multiple file formats with OCR automation.  

---

## Tech Stack

- Frontend/Dashboard: React (Dashboard)
- Backend/API: FlaskAPI, AWS EC2, PM2
- Database: AWS S3
- AI Models: AWS Bedrock (Nova Pro, Titan Embeddings G1 - Text)
- Others (Open Source): PyMuPDF (text extraction), Tesseract OCR (image text extraction), FAISS (vector similarity search), Hybrid search (KNN + string matching)
  
---

## System Architecture
![Frontend-Backend](assets/frontend-backend-architecture.png)
![Data-Ingestion-Pipeline](assets/data-ingestion-pipeline.png)
![Chatbox-Query-Pipeline](assets/chatbox-query-pipeline.png)

---

## Setup Instructions

### Self-Host
### 1. Clone the Repository
```bash
# Clone the repo
git clone https://github.com/huiying888/MedInsight.git
cd MedInsight
```
### 2. Configure AWS CLI
Make sure you have AWS CLI installed and configured:
```bash
aws configure
```
Enter your AWS Access Key, Secret Key, region, and output format.
### 3. Setup Frontend (React Dashboard)
```bash
cd med-insight-ui
npm install
npm run build
node server.js
```
### 4. Setup Backend (Flask API)
```bash
cd MedInsight
waitress-serve --host=0.0.0.0 --port=3000 flask_server:app
```

### Access the application on AWS EC2
- This application is also hosted on AWS EC2.
- Access the frontend in your browser at [http://3.219.189.107:5000/](http://3.219.189.107:5000/)

---

## Reflection

**Challenges:**
- Processing multi-source PDFs, including scanned docs, with OCR and PyMuPDF.  
- Implementing AI search with AWS Bedrock (Nova Pro, Titan) and FAISS for fast, accurate retrieval.  
- Deploying frontend (React) and backend (Flask) on AWS EC2 with PM2/Waitress and managing real-time query handling.  

**Learnings:**
- AWS Bedrock simplifies LLM integration for natural-language querying.  
- Combining structured dashboards with AI Q&A enhances flexibility and usability.  
- Using AWS S3 with FAISS enables scalable storage and semantic search for large document collections.  
- Chat-like interface with source citations improves trust and decision-making efficiency.

---

## Team: Final Fantasy 4

- Jocelyn Ngieng Hui Ying : [@huiying888](https://github.com/huiying888)
- Ng Ker Jing : [@kerjing0328](https://github.com/kerjing0328)
- Sia Sheng Jie : [@sia1010](https://github.com/sia1010)
- Teoh Yi Jen : [@Yijen10](https://github.com/Yijen10)

---

## License
MIT License — free to use and modify.
