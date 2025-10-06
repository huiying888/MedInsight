import { Link } from "react-router-dom";
import Brand from "../components/Brand";

export default function About() {
  return (
    <div className="about-page">
      {/* Top intro */}
      <section className="about-hero">
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Brand size={56} />
        </div>
        <h1>About MedInsight</h1>
        <p className="about-lead">
          MedInsight lets healthcare teams query unstructured medical documents through a chat-like interface.
          We extract, chunk, and index content so you can ask questions and get cited answers in seconds.
        </p>
      </section>

      {/* Short, simple explanation */}
      <section className="about-body">
        <h3>What it does</h3>
        <ul className="about-list">
          <li>Smart search across documents (including scanned/legacy docs with OCR).</li>
          <li>Understands structure like tables, headings, and sections.</li>
          <li>Chat-like interface that returns concise answers with source citations.</li>
        </ul>

        <h3>Why it matters</h3>
        <p>
          Clinicians and admins waste time hunting through unstructured documents. MedInsight
          turns those files into a searchable knowledge base so you can make faster, more
          confident decisions at the point of care.
        </p>

        <div className="about-cta">
          <Link to="/chat" className="cta-primary">Try the Chat</Link>
          <Link to="/upload" className="cta-secondary">Upload Docs</Link>
          <Link to="/docs" className="cta-tertiary">Browse Docs</Link>
        </div>
      </section>
    </div>
  );
}
