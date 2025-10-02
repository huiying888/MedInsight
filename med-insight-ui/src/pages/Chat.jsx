import React, { useState, useRef, useEffect, useMemo } from "react";
import axios from "axios";
import "../App.css";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { API_BASE_FRONTEND, API_BASE_BACKEND } from "./Home";

// Tell pdf.js where the worker is
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

const defaultAssistantMessage =
  "Hi there 👋 I’m your AI Assistant. Ask me anything about your documents and I’ll help you uncover insights.";

const faqItems = [
  { id: 1, q: "🩺 What are the symptoms of fever?" },
  { id: 2, q: "💊 Which patient has allergy to Penicillin?" },
  { id: 3, q: "👩🏼‍⚕️ List patients information" },
  { id: 4, q: "🩸 What is the use of aspirin?" },
];

// Utility: format AI answers nicely
// function parseAnswerToJSX(answer) {
//   const cleanAnswer = answer.replace(/\*\*/g, "");
//   const items = cleanAnswer.split(/\d+\.\s+/).filter(Boolean);

//   return items.map((item, idx) => {
//     const lines = item.split(" - ").map((line) => line.trim());

//     return (
//       <div key={idx} className="patient-card">
//         {lines.map((line, i) => {
//           const [label, value] = line.split(/:(.+)/);
//           if (value) {
//             return (
//               <p key={i}>
//                 <strong>{label}:</strong> {value}
//               </p>
//             );
//           } else {
//             return <p key={i}>{line}</p>;
//           }
//         })}
//       </div>
//     );
//   });
// }

const HighlightedTextLayer = ({ text, highlights }) => {
  // Split text into words + whitespace
  const words = text.split(/(\s+)/);

  // Debug before return
  console.log("🔎 Original text:", text);
  console.log("📌 Highlights:", highlights);

  const processed = words.map((word, i) => {
    const normalized = word.replace(/\n/g, "").trim();

    const isMatch = highlights.some(
      (h) =>
        h.toLowerCase().includes(normalized.toLowerCase()) ||
        normalized.toLowerCase().includes(h.toLowerCase())
    );

    if (normalized) {
      if (isMatch) {
        console.log(`✅ MATCH: word="${normalized}" | highlights=${JSON.stringify(highlights)}`);
      } else {
        console.log(`❌ UNMATCH: word="${normalized}"`);
      }
    }

    return isMatch ? (
      <mark key={i} style={{ backgroundColor: "yellow" }}>
        {word}
      </mark>
    ) : (
      word
    );
  });

  return <>{processed}</>;
};

// Helper: escape HTML to avoid injection when returning HTML strings
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function highlightTextToHTML(text, highlights = []) {
  if (!text || highlights.length === 0) return escapeHtml(text);

  // Normalize text for comparison
  const normalizeText = (str) => str.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const normalizedText = normalizeText(text);

  // Check if this text item should be highlighted
  const shouldHighlight = highlights.some(highlight => {
    const normalizedHighlight = normalizeText(highlight);

    // Exact match
    if (normalizedText === normalizedHighlight) return true;

    // For single words, check exact word match
    if (!normalizedHighlight.includes(' ') && !normalizedText.includes(' ')) {
      return normalizedText === normalizedHighlight;
    }

    // For phrases, check if text is part of the phrase
    if (normalizedHighlight.includes(' ')) {
      const highlightWords = normalizedHighlight.split(' ');
      const textWords = normalizedText.split(' ');

      // Check if all text words are in the highlight phrase
      return textWords.every(word => highlightWords.includes(word));
    }

    return false;
  });

  if (shouldHighlight) {
    return `<mark style="background-color:yellow">${escapeHtml(text)}</mark>`;
  }

  return escapeHtml(text);
}

export default function Chat() {
  const [q, setQ] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: defaultAssistantMessage },
  ]);
  const [loading, setLoading] = useState(false);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [latestSources, setLatestSources] = useState([]);
  const messagesEndRef = useRef(null);
  const API_URL = `${API_BASE_BACKEND}/ask`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [chatHistory]);

  async function sendQuery(queryText) {
    if (!queryText.trim()) return;

    // Add user message
    setChatHistory(h => [...h, { role: "user", content: queryText }]);
    setQ("");

    const url = `${API_BASE_BACKEND}/ask?question=${encodeURIComponent(queryText)}&session_id=default`;
    const evtSource = new EventSource(url);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status) {
          // 🚀 Replace the temp message with the latest status + animated dots
          setChatHistory(h => [
            ...h.filter(m => m.role !== "assistant_temp"),
            { role: "assistant_temp", content: `${data.status} …` } // you can animate the dots in UI
          ]);
        } else if (data.answer) {
          evtSource.close();
          // ✅ Replace temp status bubble with final answer
          setChatHistory(h => [
            ...h.filter(m => m.role !== "assistant_temp"),
            {
              role: "assistant",
              content: data.answer,
              sources: data.sources,
              suggestions: data.suggestions
            }
          ]);
        } else if (data.error) {
          evtSource.close();
          setChatHistory(h => [
            ...h.filter(m => m.role !== "assistant_temp"),
            { role: "assistant", content: `⚠️ Error: ${data.error}` }
          ]);
        }
      } catch (err) {
        console.error("SSE parse error:", err, event.data);
      }
    };

    evtSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      evtSource.close();
      // clear temp bubble if it exists
      setChatHistory(h => h.filter(m => m.role !== "assistant_temp"));
    };
  }



  const handleFaqClick = (faqQuery) => sendQuery(faqQuery);

  // ✅ Extract highlights from all sources in chat history for the selected PDF
  const pdfHighlights = useMemo(() => {
    if (!selectedPdf) return [];

    console.log('Selected PDF:', selectedPdf);

    // Find all sources from all messages that match the selected PDF
    const allSources = chatHistory
      .filter(m => m.role === 'assistant' && m.sources)
      .flatMap(m => m.sources);

    console.log('All sources:', allSources);

    // More flexible matching - check file name and page
    const matchingSources = allSources.filter(s => {
      const urlMatch = s.url === selectedPdf.url ||
        (s.file && selectedPdf.url && selectedPdf.url.includes(s.file)) ||
        (s.key && selectedPdf.url && selectedPdf.url.includes(s.key));
      const pageMatch = s.page === selectedPdf.page;
      return urlMatch && pageMatch;
    });

    console.log('Matching sources:', matchingSources);

    const highlights = matchingSources.flatMap((s) => {
      if (!s.highlight) return [];

      const highlightStr = Array.isArray(s.highlight)
        ? s.highlight.join(" ")
        : String(s.highlight);

      const highlights = [];

      // Add the complete string
      highlights.push(highlightStr.trim());

      // Add meaningful phrases (2-4 words)
      const words = highlightStr.split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        // 2-word phrases
        const phrase2 = words.slice(i, i + 2).join(' ').trim();
        if (phrase2.length > 5) highlights.push(phrase2);

        // 3-word phrases
        if (i < words.length - 2) {
          const phrase3 = words.slice(i, i + 3).join(' ').trim();
          if (phrase3.length > 8) highlights.push(phrase3);
        }
      }

      // Add individual meaningful words
      words.forEach(word => {
        const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '');
        if (cleanWord.length > 3) highlights.push(cleanWord);
      });

      return [...new Set(highlights)].filter(h => h && h.length > 3);
    });

    console.log('Final highlights:', highlights);
    return highlights;
  }, [selectedPdf, chatHistory]);


  useEffect(() => {
    console.log("🔍 Current highlights:", pdfHighlights);
  }, [pdfHighlights]);

  const navigate = useNavigate();

  return (
    <div className="chat-layout">
      {/* Left: Chat Section */}
      <div className={`chat-panel ${selectedPdf ? "shrunk" : ""}`}>
        <div className="top-section">
          <h1 className="chat-header">💬 MedInsight</h1>
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
                {m.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} linkBreaks>
                    {m.content.replace(/\n/g, "  \n")}
                  </ReactMarkdown>
                ) : m.role === "assistant_temp" ? (
                  // ✅ Show temporary status with animated dots
                  <span className="typing-dots">{m.content}</span>
                ) : (
                  m.content
                )}

                {m.role === "assistant" &&
                  (m.sources?.length > 0 || m.suggestions?.length > 0) && (
                    <div
                      style={{
                        marginTop: 10,
                        borderTop: "1px solid #eee",
                        paddingTop: 8,
                      }}
                    >
                      {m.sources?.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sources</div>
                          <ol style={{ margin: 0, paddingLeft: 18, marginBottom: 12 }}>
                            {m.sources.map((s, idx) => (
                              <li key={idx} style={{ marginBottom: 8 }}>
                                <button
                                  className="source-link"
                                  onClick={() =>
                                    setSelectedPdf({ url: s.url, page: s.page })
                                  }
                                >
                                  {s.file || s.key} {s.page ? `(p. ${s.page})` : ""}
                                </button>
                              </li>
                            ))}
                          </ol>
                        </>
                      )}

                      {m.suggestions?.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            💡 Suggested Questions
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                          >
                            {m.suggestions.map((suggestion, idx) => (
                              <button
                                key={idx}
                                className="suggestion-button"
                                onClick={() => sendQuery(suggestion)}
                                style={{
                                  padding: "8px 12px",
                                  backgroundColor: "#f0f8ff",
                                  border: "1px solid #d0e7ff",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  fontSize: "14px",
                                  transition: "all 0.2s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.backgroundColor = "#e6f3ff";
                                  e.target.style.borderColor = "#b3d9ff";
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.backgroundColor = "#f0f8ff";
                                  e.target.style.borderColor = "#d0e7ff";
                                }}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))}

          {/* ❌ remove old loading box — handled by assistant_temp now */}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area-fixed">
          <div className="chat-input-wrapper">
            <button
              type="button"
              className="upload-btn"
              title="Go to Upload page"
              onClick={() => navigate("/upload")}
            >
              +
            </button>
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

      {/* Right: PDF Viewer */}
      <div className={`pdf-viewer ${selectedPdf ? "open" : ""}`}>
        <div className="pdf-header">
          <strong>📄 PDF Viewer</strong>
          <button onClick={() => setSelectedPdf(null)} className="close-btn">
            ❌
          </button>
        </div>
        {selectedPdf && (
          <div className="pdf-viewer-body">
            <Document file={selectedPdf} onLoadError={console.error}>
              <Page
                pageNumber={selectedPdf.page || 1}
                renderTextLayer={true}   // ✅ force text layer
                renderAnnotationLayer={false} // optional: cleaner view
                customTextRenderer={(textItem) => {
                  // Debug: this should run for each text item in the page's text layer
                  console.log("📌 customTextRenderer invoked; textItem:", textItem);
                  console.log("🔍 current pdfHighlights:", pdfHighlights);

                  // Return HTML string (react-pdf applies it as innerHTML)
                  try {
                    return highlightTextToHTML(textItem.str, pdfHighlights);
                  } catch (e) {
                    console.error("Error in customTextRenderer:", e);
                    // Fallback to plain escaped text
                    return escapeHtml(textItem.str || "");
                  }
                }}
              />


            </Document>
          </div>
        )}
      </div>
    </div>
  );
}
