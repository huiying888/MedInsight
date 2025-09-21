import { Link } from "react-router-dom";
import Brand from "../components/Brand";
import { getUser } from "../utils/authMock";

export default function Home() {
  const user = getUser();

  return (
    <div className="home">
      {/* HERO */}
      <section className="hero hero--fancy">
        <div className="hero-bg" />
        <div className="hero-inner">
          <div className="hero-brand">
            {/* Hero variant → large logo, small text */}
            <Brand size={60} variant="hero" />
            <div className="badge-row">
              <span className="badge">AI medical PDF search</span>
              <span className="badge">AWS-first</span>
              <span className="badge">ap-southeast-5 🇲🇾</span>
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

          {/* CTA: if not logged in, nudge to login/register; else go straight to chat */}
          <div className="cta-row">
            {!user ? (
              <>
                <Link className="cta-primary" to="/login">Login to start</Link>
                <Link className="cta-secondary" to="/register">Create account</Link>
              </>
            ) : (
              <>
                <Link className="cta-primary" to="/chat">Start asking</Link>
                <Link className="cta-secondary" to="/upload">Upload documents</Link>
                <Link className="cta-tertiary" to="/docs">Browse bucket</Link>
              </>
            )}
          </div>

          {/* quick trust mini-row */}
          <div className="trust-row">
            <div className="trust-item">🔒 Privacy-first (S3 + least-privilege)</div>
            <div className="dot">•</div>
            <div className="trust-item">📄 OCR-ready (scanned PDFs supported)</div>
            <div className="dot">•</div>
            <div className="trust-item">💸 Credit-friendly (batching & caching)</div>
          </div>

          {/* animated stats */}
          <div className="stat-rail">
            <div className="stat-card">
              <div className="stat-num">10×</div>
              <div className="stat-label">Faster lookups</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">0 PDFs</div>
              <div className="stat-label">Left unsearchable</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">1 Click</div>
              <div className="stat-label">Citations to source</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE GRID */}
      <section className="features features--glass">
        <div className="feature-card">
          <div className="feature-icon" aria-hidden>🧠</div>
          <h3>Smart search</h3>
          <p>Ask in natural language. We extract answers—even from tables and long PDFs.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon" aria-hidden>🖨️</div>
          <h3>Works with scans</h3>
          <p>OCR pipeline for scanned/legacy docs so nothing gets missed.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon" aria-hidden>🔒</div>
          <h3>Privacy-first</h3>
          <p>S3 storage, least-privilege access. Malaysia region prioritized.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon" aria-hidden>💡</div>
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

      {/* MINI FAQ */}
      <section className="faq">
        <h2>FAQ</h2>
        <details className="faq-item" open>
          <summary>Is this safe for patient data?</summary>
          <p>Yes. Documents live in your S3 bucket. Access follows least-privilege IAM and never leaves your AWS account during processing.</p>
        </details>
        <details className="faq-item">
          <summary>Does it work with scanned PDFs?</summary>
          <p>Absolutely. Our OCR stage extracts text from scanned/legacy documents so they become searchable.</p>
        </details>
        <details className="faq-item">
          <summary>What about costs?</summary>
          <p>We batch operations, cache results, and limit calls to stay within tight credits—ideal for hackathons and pilots.</p>
        </details>
      </section>

      <footer className="site-footer">
        <Link to="/about">About Us</Link>
      </footer>
    </div>
  );
}
