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
              <span className="badge">ap-southeast-5</span>
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

      {/* HOW IT WORKS */}
      <section className="how">
        <h2>How it works</h2>
        <ol>
          <li><strong>Upload:</strong> Drop PDFs into your S3 folder.</li>
          <li><strong>Index:</strong> Text + structure extracted; embeddings prepared.</li>
          <li><strong>Ask:</strong> Use Chat to query; answers cite their source files.</li>
        </ol>
      </section>

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} MedInsight</span>
        <span className="dot">•</span>
        <Link to="/about">About</Link>
      </footer>
    </div>
  );
}
