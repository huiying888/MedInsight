import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import "../App.css";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";



// Tell pdf.js where the worker is
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

const defaultAssistantMessage =
  "Hi there 👋 I’m your AI Assistant. Ask me anything about your documents and I’ll help you uncover insights.";

const faqItems = [
  { id: 1, q: "🩺 What is this patient's current medications and any known allergies?" },
  { id: 2, q: "💊 Is there any previous treatment received?" },
  { id: 3, q: "👩🏼‍⚕️ List the patient information" },
  { id: 4, q: "🩸 Show me last lab report result" },
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
  if (!text) return "";

  // Escape HTML safely
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  // Normalize: strip punctuation + collapse whitespace + lowercase
  function normalize(str) {
    return str
      .replace(/[.,:;!?\ –—()\[\]{}'"`]/g, "") // remove punctuation
      .replace(/\s+/g, " ") // collapse whitespace
      .toLowerCase()
      .trim();
  }

  // Sort highlights by length (longer first = phrase priority)
  const sorted = Array.from(new Set(highlights.map((h) => h.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length);

  console.log("🔍 highlightTextToHTML: highlights =", sorted);

  if (sorted.length === 0) return escapeHtml(text);

  // Build regex for all highlights (normalize + flexible spaces)
  const normalizedHighlights = sorted.map(normalize);
  const pattern = normalizedHighlights.map((s) => s.replace(/ /g, "\\s+")).join("|");
  const re = new RegExp(pattern, "gi");

  console.log("🧩 highlightTextToHTML: regex =", re);

  // Work on normalized text but map back to original string
  const normalizedText = normalize(text);
  let result = "";
  let lastIndex = 0;

  let match;
  while ((match = re.exec(normalizedText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Map normalized index back to original substring
    const origSub = text.substring(start, end);

    // Append plain + highlighted
    result += escapeHtml(text.slice(lastIndex, start));
    result += `<mark style="background-color:yellow">${escapeHtml(origSub)}</mark>`;

    lastIndex = end;
  }

  // Append trailing part
  result += escapeHtml(text.slice(lastIndex));

  console.log("✅ highlightTextToHTML: result preview =", result);

  return result;
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
        return { ...s, url, file: s.file };
      });

      // ✅ Reset sources for this query only
      setLatestSources(sources);

      // Save message with sources
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: (data.answer), sources },
      ]);

      // ✅ Store latest sources for highlighting
      // setLatestSources(sources);
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

  // ✅ Extract highlights only from latest sources
  const pdfHighlights = latestSources.flatMap((s) => {
    if (!s.highlight) return [];

    // Ensure highlight is a string
    const highlightStr = Array.isArray(s.highlight)
      ? s.highlight.join("\n")
      : String(s.highlight);

    return highlightStr
      .split(/\n|[,;]+|\s{2,}|\s-\s/)
      .flatMap((h) => {
        if (h.includes(":")) {
          const [left, right] = h.split(":");
          return [left.trim(), right.trim()].filter(Boolean);
        }
        return [h.trim()];
      })
      .filter(Boolean);
  });


  useEffect(() => {
    console.log("🔍 Current highlights:", pdfHighlights);
  }, [pdfHighlights]);

  return (
    <div className="chat-layout">
      {/* Left: Chat Section */}
      <div className={`chat-panel ${selectedPdf ? "shrunk" : ""}`}>
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
                {m.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} linkBreaks>{m.content.replace(/\n/g, "  \n")}</ReactMarkdown>
                ) : (
                  m.content
                )}

                {m.role === "assistant" && m.sources?.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      borderTop: "1px solid #eee",
                      paddingTop: 8,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Sources</div>
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      {m.sources.map((s, idx) => (
                        <li key={idx} style={{ marginBottom: 8 }}>
                          <button
                            className="source-link"
                            onClick={() => setSelectedPdf({ url: s.url, page: s.page })}
                          >
                            {s.file || s.key} {s.page ? `(p. ${s.page})` : ""}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          ))}
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