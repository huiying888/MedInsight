// src/pages/Upload.jsx
import React, { useState } from "react";

export default function UploadDocs() {
  const [patientFiles, setPatientFiles] = useState([]);
  const [guidelineFiles, setGuidelineFiles] = useState([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleFileChange = (e, setter) => setter(Array.from(e.target.files));

  // upload a single file using presigned URL
  const uploadFile = async (file, folder) => {
    try {
      const res = await fetch("http://localhost:5000/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          folder,
        }),
      });
      console.log("Presign response status:", res.status);
      const { url } = await res.json();

      const uploadRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Upload failed");
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const handleConfirmUpload = async () => {
    if (patientFiles.length === 0 && guidelineFiles.length === 0 && knowledgeFiles.length === 0) {
    setErr("❌ No files selected for upload.");
    setSuccessMsg("");
    return;
  }
    setLoading(true);
    setErr("");
    setSuccessMsg("");

    try {
      const allFiles = [
        ...patientFiles.map((f) => uploadFile(f, "patients")),
        ...guidelineFiles.map((f) => uploadFile(f, "guidelines")),
        ...knowledgeFiles.map((f) => uploadFile(f, "knowledge")),
      ];
      await Promise.all(allFiles);
      setSuccessMsg("✅ All files uploaded successfully!");
      setPatientFiles([]);
      setGuidelineFiles([]);
      setKnowledgeFiles([]);
    } catch {
      setErr("❌ Upload failed. Check console for errors.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-page-container">
      <div className="top-section">
        <h1 className="chat-header">📂 Upload Documents</h1>
        <p className="chat-subtitle">
          Choose or drag-and-drop files into the right section. Files will be stored in your S3 bucket.
        </p>
      </div>

      <div className="upload-sections">
        {/* Patient Records */}
        <div className="upload-card">
          <h3>🩺 Patient Records</h3>
          <input type="file" multiple onChange={(e) => handleFileChange(e, setPatientFiles)} />
          <ul className="file-list">{patientFiles.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
        </div>

        {/* Guidelines */}
        <div className="upload-card">
          <h3>📘 Guidelines</h3>
          <input type="file" multiple onChange={(e) => handleFileChange(e, setGuidelineFiles)} />
          <ul className="file-list">{guidelineFiles.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
        </div>

        {/* Knowledge Base */}
        <div className="upload-card">
          <h3>💡 Knowledge</h3>
          <input type="file" multiple onChange={(e) => handleFileChange(e, setKnowledgeFiles)} />
          <ul className="file-list">{knowledgeFiles.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
        </div>
      </div>

      {/* Confirm Buttons using original CSS */}
      <div className="confirm-button-container">
        <button
          className="confirm-button"
          onClick={handleConfirmUpload}
          disabled={loading}
        >
          {loading ? "Uploading..." : "Confirm Upload"}
        </button>
      </div>

      {/* Status */}
    <div style={{ textAlign: "center", marginTop: 16 }}>
      {err && <p style={{ color: "red", margin: 4 }}>{err}</p>}
      {successMsg && <p style={{ color: "green", margin: 4 }}>{successMsg}</p>}
    </div>
    </div>
  );
}