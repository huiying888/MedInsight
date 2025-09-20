import { Link } from "react-router-dom";
import Brand from "../components/Brand";

export default function Home() {
  return (
    <div className="home">
      {/* HERO */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-brand">
            <Brand size={56} />
            <div className="badge-row">
              <span className="badge">AI medical PDF search</span>
              <span className="badge">AWS-first</span>
              <span className="badge">us-east-1</span>
            </div>
          </div>

          <h1 className="hero-title">
            Ask questions. Get answers.<br />
            <span className="accent">From all your medical PDFs.</span>
          </h1>

          <p className="hero-subtitle">
            MedInsight turns unstructured guidelines, scans, and reports into a searchable knowledge base.
            Natural-language queries. Fast lookups. Better decisions.
          </p>

          <div className="cta-row">
            <Link className="cta-primary" to="/chat">Start asking</Link>
            <Link className="cta-secondary" to="/upload">Upload documents</Link>
            <Link className="cta-tertiary" to="/docs">Browse bucket</Link>
          </div>

          <p className="mini-help">
            Tip: set your default folder and theme in <Link to="/settings">Settings</Link>.
          </p>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features">
        <div className="feature-card">
          <h3>Smart search</h3>
          <p>Ask in natural language. We extract answers even from tables and long PDFs.</p>
        </div>
        <div className="feature-card">
          <h3>Works with scans</h3>
          <p>OCR-ready pipeline for scanned/legacy docs so nothing gets missed.</p>
        </div>
        <div className="feature-card">
          <h3>Privacy-first</h3>
          <p>S3 storage, least-privilege access. Malaysia region prioritized.</p>
        </div>
        <div className="feature-card">
          <h3>Budget aware</h3>
          <p>Designed to run within tight credits—batching, caching, and minimal calls.</p>
        </div>
      </section>

      {/* HOW IT WORKS (enhanced) */}
      <section className="how how-v2">
        <h2>How it works</h2>

        <div className="hiw-rail">
          {/* Step 1 */}
          <div className="hiw-step">
            <div className="hiw-badge">1</div>
            <div className="hiw-icon" aria-hidden>📤</div>
            <h3>Upload</h3>
            <p>
              Drop PDFs into your S3 bucket or use the <strong>Upload</strong> page.
              Scans and legacy docs are supported.
            </p>
            <div className="hiw-meta">
              <span>Region:</span>&nbsp;<code>us-east-1</code>
            </div>
          </div>

          <div className="hiw-arrow" />

          {/* Step 2 */}
          <div className="hiw-step">
            <div className="hiw-badge">2</div>
            <div className="hiw-icon" aria-hidden>🧠</div>
            <h3>Index</h3>
            <p>
              We extract text & structure, run OCR if needed, and build compact embeddings
              for fast, low-cost retrieval.
            </p>
            <ul className="hiw-list">
              <li>OCR for scanned PDFs</li>
              <li>Understands tables & figures</li>
              <li>Batching to save credits</li>
            </ul>
          </div>

          <div className="hiw-arrow" />

          {/* Step 3 */}
          <div className="hiw-step">
            <div className="hiw-badge">3</div>
            <div className="hiw-icon" aria-hidden>💬</div>
            <h3>Ask</h3>
            <p>
              Ask in natural language. Answers include citations to the exact source
              files and pages for auditability.
            </p>
            <div className="hiw-meta">
              <span>Output:</span>&nbsp;Evidence-linked answers
            </div>
          </div>
        </div>
      </section>


      <footer className="site-footer">
        <span>© {new Date().getFullYear()} MedInsight</span>
        <span className="dot">•</span>
        <Link to="/about">About</Link>
      </footer>
    </div>
  );
}
