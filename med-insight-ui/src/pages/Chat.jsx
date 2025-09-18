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

export default function Chat() {
  const [q, setQ] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: defaultAssistantMessage },
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const API_URL = process.env.REACT_APP_API_URL || "https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/prod/query";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
    behavior: "smooth",
    block: "nearest"  // ensures it only scrolls enough, not under navbar
  });
  }, [chatHistory]);

  async function sendQuery(queryText) {
    if (!queryText.trim()) return;
    setChatHistory((h) => [...h, { role: "user", content: queryText }]);
    setQ("");
    setLoading(true);
    try {
      const { data } = await axios.post(API_URL, { query: queryText });
      setChatHistory((h) => [...h, { role: "assistant", content: data.answer }]);
    } catch (err) {
      console.error(err);
      setChatHistory((h) => [...h, { role: "assistant", content: "An error occurred. Please try again." }]);
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
        <h1 className="chat-header">💬 MediInsightAI</h1>
        <p className="chat-subtitle">I'm here to help you uncover business insights from your medical documents.</p>
        <div className="faq-grid">
          {faqItems.map((item) => (
            <button key={item.id} className="faq-button" onClick={() => handleFaqClick(item.q)}>
              {item.q}
            </button>
          ))}
        </div>
      </div>

      <div className="chat-history-container">
        {chatHistory.map((m, i) => (
          <div key={i} className={`message-wrapper ${m.role}`}>
            <div className="message-bubble">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="message-wrapper assistant">
            <div className="message-bubble loading-bubble">
              <div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area-fixed">
        <div className="chat-input-wrapper">
          <label htmlFor="file-upload" className="upload-btn" title="Upload PDF">
            +
            <input id="file-upload" type="file" onChange={handleFileUpload} accept=".pdf,.txt" style={{ display: "none" }} />
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
          <button className="send-button" onClick={() => sendQuery(q)} disabled={loading || !q.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
