// src/pages/Upload.jsx
// change URL to localhost for testing
import React, { useState, useRef } from "react";

export default function UploadDocs() {
  const [patientFiles, setPatientFiles] = useState([]);
  const [guidelineFiles, setGuidelineFiles] = useState([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [jobStatus, setJobStatus] = useState([]); // array of {folder, file, status}
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  // refs for file inputs
  const patientInputRef = useRef();
  const guidelineInputRef = useRef();
  const knowledgeInputRef = useRef();

  const handleFileChange = (e, setter) => setter(Array.from(e.target.files));

  const uploadFile = async (file, folder) => {
    try {
      const res = await fetch("http://3.90.51.95:5000/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type, folder }),
      });
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

  const startProcessing = async (jobsToProcess, startIndex = 0) => {
    const promises = jobsToProcess.map((job, i) =>
      (async () => {
        // Update status to Processing
        setJobStatus(prev => {
          const updated = [...prev];
          updated[startIndex + i].status = "Processing...";
          return updated;
        });

        try {
          const res = await fetch("http://3.90.51.95:3000/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: job.folder, file: job.file }),
          });

          if (!res.ok) throw new Error(`Processing failed for ${job.folder}: ${job.file}`);
          await res.json();

          // Update status to Completed
          setJobStatus(prev => {
            const updated = [...prev];
            updated[startIndex + i].status = "✅ Completed";
            return updated;
          });
        } catch (e) {
          console.error(e);
          setJobStatus(prev => {
            const updated = [...prev];
            updated[startIndex + i].status = "❌ Failed";
            return updated;
          });
        }
      })()
    );

    await Promise.all(promises);
  };



  const handleConfirmUpload = async () => {
    if (patientFiles.length === 0 && guidelineFiles.length === 0 && knowledgeFiles.length === 0) {
      setErr("❌ No files selected for upload.");
      setSuccessMsg("");
      return;
    }

    setUploading(true);
    setErr("");
    setSuccessMsg("");

    try {
      // Upload all files
      const allUploads = [
        ...patientFiles.map((f) => uploadFile(f, "patients")),
        ...guidelineFiles.map((f) => uploadFile(f, "guidelines")),
        ...knowledgeFiles.map((f) => uploadFile(f, "knowledge")),
      ];
      await Promise.all(allUploads);
      setSuccessMsg("✅ Files uploaded successfully!");

      // Prepare new jobs
      const newJobs = [
        ...patientFiles.map((f) => ({ folder: "patients", file: f.name, status: "Pending" })),
        ...guidelineFiles.map((f) => ({ folder: "guidelines", file: f.name, status: "Pending" })),
        ...knowledgeFiles.map((f) => ({ folder: "knowledge", file: f.name, status: "Pending" })),
      ];

      // Calculate start index for new jobs
      const startIndex = jobStatus.length;

      // Append new jobs
      setJobStatus(prev => [...prev, ...newJobs]);

      // Start processing new jobs separately
      startProcessing(newJobs, startIndex);

      // Clear file selections and input values
      setPatientFiles([]);
      setGuidelineFiles([]);
      setKnowledgeFiles([]);
      if (patientInputRef.current) patientInputRef.current.value = "";
      if (guidelineInputRef.current) guidelineInputRef.current.value = "";
      if (knowledgeInputRef.current) knowledgeInputRef.current.value = "";

    } catch (e) {
      console.error(e);
      setErr("❌ Upload failed. Check console for details.");
    } finally {
      setUploading(false);
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
        {["patients", "guidelines", "knowledge"].map((type) => {
          const files = type === "patients" ? patientFiles :
            type === "guidelines" ? guidelineFiles : knowledgeFiles;
          const setFiles = type === "patients" ? setPatientFiles :
            type === "guidelines" ? setGuidelineFiles : setKnowledgeFiles;
          const label = type === "patients" ? "🩺 Patient Records" :
            type === "guidelines" ? "📘 Guidelines" : "💡 Knowledge";

          return (
            <div className="upload-card" key={type}>
              <h3>{label}</h3>
              <input
                type="file"
                multiple
                ref={type === "patients" ? patientInputRef :
                  type === "guidelines" ? guidelineInputRef :
                    knowledgeInputRef}
                onChange={(e) => handleFileChange(e, setFiles)}
              />              <ul className="file-list">{files.map((f, i) => <li key={i}>{f.name}</li>)}</ul>
            </div>
          );
        })}
      </div>

      <div className="confirm-button-container">
        <button
          className="confirm-button"
          onClick={handleConfirmUpload}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Confirm Upload"}
        </button>
      </div>

      <div style={{ textAlign: "center", marginTop: 16 }}>
        {err && <p style={{ color: "red", margin: 4 }}>{err}</p>}
        {successMsg && <p style={{ color: "green", margin: 4 }}>{successMsg}</p>}

        {/* Job Status List */}
        {jobStatus.length > 0 && (
          <section className="job-panel" role="region" aria-label="Digesting Documents">
            <div className="job-panel-title">🖥 Digesting Documents</div>

            {/* Scrollable container */}
            <div className="job-panel-body">
              <div className="job-status-list">
                {jobStatus.map((job, i) => (
                  <div className="job-card" key={`${job.folder}-${job.file}-${i}`}>
                    <div className="job-info">
                      <strong>{job.folder} / {job.file}</strong>
                    </div>
                    <div
                      className={
                        "job-badge " +
                        (job.status.includes("Processing") ? "processing" :
                          job.status.includes("Completed") ? "completed" : "failed")
                      }
                    >
                      {job.status}
                      {job.status.includes("Processing") && (
                        <span className="loading-dots"><span></span><span></span><span></span></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}