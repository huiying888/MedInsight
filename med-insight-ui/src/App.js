import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css'; 

const defaultAssistantMessage = "Hi there 👋 I’m your AI Assistant. Ask me anything about your documents and I’ll help you uncover insights.";

const faqItems = [
  { id: 1, q: "🩺 What is this patient's current medications and any known allergies?" },
  { id: 2, q: "💊 Is there any previous treatment received?" },
  { id: 3, q: "👩🏼‍⚕️ List the patient information" },
  { id: 4, q: "🩸 Show me last lab report result" },
];

export default function ChatApp() {
  const [q, setQ] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', content: defaultAssistantMessage },
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to the bottom of the chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  async function sendQuery(queryText) {
    if (!queryText.trim()) return;

    // Add user message to history
    setChatHistory((prevHistory) => [...prevHistory, { role: 'user', content: queryText }]);
    setQ('');
    setLoading(true);

    try {
      // Replace with your actual API Gateway endpoint
      const apiUrl = 'https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/prod/query';
      const response = await axios.post(apiUrl, { query: queryText });
      
      // Add assistant response to history
      setChatHistory((prevHistory) => [...prevHistory, { role: 'assistant', content: response.data.answer }]);
    } catch (error) {
      console.error("Error fetching response:", error);
      setChatHistory((prevHistory) => [
        ...prevHistory,
        { role: 'assistant', content: "An error occurred. Please try again." }
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Handle FAQ button clicks
  const handleFaqClick = (faqQuery) => {
    sendQuery(faqQuery);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      alert(`Simulating upload of: ${file.name}`);
      // In a real app, you would handle the file upload here
      // e.g., using Axios to post the file to your S3 API.
    }
  };

  return (
    <div className="chat-page-container">
      {/* Header and FAQ section */}
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

      {/* Chat History */}
      <div className="chat-history-container">
        {chatHistory.map((message, index) => (
          <div key={index} className={`message-wrapper ${message.role}`}>
            <div className="message-bubble">{message.content}</div>
          </div>
        ))}
        {loading && (
          <div className="message-wrapper assistant">
            <div className="message-bubble loading-bubble">
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area - fixed to the bottom */}
      <div className="chat-input-area-fixed">
        <div className="chat-input-wrapper">
          <label htmlFor="file-upload" className="upload-btn" title="Upload PDF">
            +
            <input id="file-upload" type="file" onChange={handleFileUpload} accept=".pdf,.txt" style={{ display: 'none' }} />
          </label>
          <input
            type="text"
            className="chat-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendQuery(q)}
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
