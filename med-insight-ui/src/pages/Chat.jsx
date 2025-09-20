import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import "../App.css"; // keep your styles

const defaultAssistantMessage =
  "Hi there 👋 I’m your AI Assistant. Ask me anything about your documents and I’ll help you uncover insights.";

const faqItems = [
  { id: 1, q: "🩺 What is this patient's current medications and any known allergies?" },
  { id: 2, q: "💊 Is there any previous treatment received?" },
  { id: 3, q: "👩🏼‍⚕️ List the patient information" },
  { id: 4, q: "🩸 Show me last lab report result" },
];
function parseAnswerToJSX(answer) {
  // Remove all ** markers
  const cleanAnswer = answer.replace(/\*\*/g, "");

  // Split by numbered list items (1., 2., 3., …)
  const items = cleanAnswer.split(/\d+\.\s+/).filter(Boolean);

  return items.map((item, idx) => {
    // Split by " - " as before
    const lines = item.split(" - ").map((line) => line.trim());

    return (
      <div key={idx} className="patient-card">
        {lines.map((line, i) => {
          // Split into key-value if colon exists
          const [label, value] = line.split(/:(.+)/);
          if (value) {
            return (
              <p key={i}>
                <strong>{label}:</strong> {value}
              </p>
            );
          } else {
            return <p key={i}>{line}</p>;
          }
        })}
      </div>
    );
  });
}

export default function Chat() {
  const [q, setQ] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: defaultAssistantMessage },
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000/ask";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [chatHistory]);

  async function sendQuery(queryText) {
    if (!queryText.trim()) return;

    setChatHistory((h) => [...h, { role: "user", content: queryText }]);
    setQ("");
    setLoading(true);

    try {
      const { data } = await axios.post(API_URL, { question: queryText });

      // Convert S3 URIs (s3://bucket/key) → HTTPS URLs
      const sources = (data.sources || []).map((s) => {
        let url = s.url;
        if (url.startsWith("s3://")) {
          const [, bucket, ...keyParts] = url.split("/");
          const key = keyParts.join("/");
          url = `https://${bucket}.s3.us-east-1.amazonaws.com/${encodeURIComponent(key)}`;
        }
        return { ...s, url };
      });

      // Only display the assistant answer (omit contexts)
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: parseAnswerToJSX(data.answer), sources: data.sources },
      ]);
    } catch (err) {
      console.error(err);
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: "An error occurred. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }


  const handleFaqClick = (faqQuery) => sendQuery(faqQuery);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) alert(`Simulating upload of: ${file.name}`);
  };

  return (
    <div className="chat-page-container">
      <div className="top-section">
        <h1 className="chat-header">💬 MedInsightAI</h1>
        <p className="chat-subtitle">
          I'm here to help you uncover business insights from your medical documents.
        </p>
        <div className="faq-grid">
          {faqItems.map((item) => (
            <button
              key={item.id}
              className="faq-button"
              onClick={() => handleFaqClick(item.q)}
            >
              {item.q}
            </button>
          ))}
        </div>
      </div>

      <div className="chat-history-container">
        {chatHistory.map((m, i) => (
          <div key={i} className={`message-wrapper ${m.role}`}>
            <div className="message-bubble">
              {m.content}
              {m.role === "assistant" && m.sources?.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Sources</div>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    {m.sources.map((s, idx) => (
                      <li key={idx} style={{ marginBottom: 8 }}>
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#e26d6d", fontWeight: 600 }}>
                          {s.file || s.key} {s.page ? `(p. ${s.page})` : ""}
                        </a>
                        {s.highlight && <blockquote style={{ margin: "6px 0 0 0", color: "#555" }}>{s.highlight}</blockquote>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

            </div>
          </div>
        ))}
        {/* {chatHistory.map((m, i) => (
          <div key={i} className={`message-wrapper ${m.role}`}>
            <div className="message-bubble">
              {m.content}

              </div>
          </div>
        ))} */}
        {loading && (
          <div className="message-wrapper assistant">
            <div className="message-bubble loading-bubble">
              <div className="loading-dot" />
              <div className="loading-dot" />
              <div className="loading-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area-fixed">
        <div className="chat-input-wrapper">
          <label htmlFor="file-upload" className="upload-btn" title="Upload PDF">
            +
            <input
              id="file-upload"
              type="file"
              onChange={handleFileUpload}
              accept=".pdf,.txt"
              style={{ display: "none" }}
            />
          </label>
          <input
            type="text"
            className="chat-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendQuery(q)}
            placeholder="Ask me something about your documents..."
            disabled={loading}
          />
          <button
            className="send-button"
            onClick={() => sendQuery(q)}
            disabled={loading || !q.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
