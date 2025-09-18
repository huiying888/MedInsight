import { useEffect, useMemo, useState } from "react";

const BUCKET = process.env.REACT_APP_S3_BUCKET || "meddoc-raw";
const REGION = process.env.REACT_APP_S3_REGION || "us-east-1";
const S3_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
const NS = "http://s3.amazonaws.com/doc/2006-03-01/";

/* Go up one folder from a prefix like "knowledge/sub/" -> "knowledge/" */
function parentPrefix(pfx = "") {
  if (!pfx) return "";
  const parts = pfx.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? parts.join("/") + "/" : "";
}

async function listS3(prefix = "") {
  const url = `${S3_BASE}?list-type=2&delimiter=/&prefix=${encodeURIComponent(prefix)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`S3 list error ${r.status}`);
  const xml = await r.text();

  const dom = new window.DOMParser().parseFromString(xml, "application/xml");

  const folders = Array.from(dom.getElementsByTagNameNS(NS, "CommonPrefixes"))
    .map(cp => cp.getElementsByTagNameNS(NS, "Prefix")[0]?.textContent || "");

  let files = Array.from(dom.getElementsByTagNameNS(NS, "Contents")).map(c => ({
    key: c.getElementsByTagNameNS(NS, "Key")[0]?.textContent || "",
    size: Number(c.getElementsByTagNameNS(NS, "Size")[0]?.textContent || "0"),
    lastModified: c.getElementsByTagNameNS(NS, "LastModified")[0]?.textContent || "",
  }));

  // remove folder markers
  files = files.filter(f => !(f.key.endsWith("/") && f.size === 0));

  // direct link for open
  files = files.map(f => ({
    ...f,
    url: `${S3_BASE}/${encodeURIComponent(f.key).replace(/%2F/g, "/")}`,
  }));

  return { folders, files };
}

export default function Docs() {
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const crumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    return [
      { label: "root", pfx: "" },
      ...parts.map((p, i) => ({ label: p, pfx: parts.slice(0, i + 1).join("/") + "/" }))
    ];
  }, [prefix]);

  async function load(pfx = "") {
    // Use overlay instead of inserting a "Loading..." element to avoid layout shift
    setLoading(true);
    setErr("");
    try {
      const { folders, files } = await listS3(pfx);
      setFolders(folders);
      setFiles(files);
      setPrefix(pfx);
    } catch (e) {
      console.error(e);
      setErr("❌ Failed to load from S3. Check bucket policy & CORS.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(""); }, []);

  return (
    <div className="chat-page-container">
      {/* Header */}
      <div className="top-section">
        <h1 className="chat-header">📂 Bucket Browser</h1>
        <p className="chat-subtitle">
          Browsing {BUCKET} in {REGION}
        </p>

        {/* Breadcrumbs + Up button bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 16
          }}
        >
          <div style={{ fontWeight: 500, color: "#333" }}>
            {crumbs.map((c, i) => (
              <span key={c.pfx}>
                <a
                  href="#!"
                  onClick={() => load(c.pfx)}
                  style={{ color: "#e26d6d", textDecoration: "none" }}
                >
                  {c.label}
                </a>
                {i < crumbs.length - 1 ? " / " : ""}
              </span>
            ))}
          </div>

          <button
            className="faq-button"
            onClick={() => load(parentPrefix(prefix))}
            disabled={!prefix}
            title="Go up one folder"
            style={{ padding: "0.5em 0.9em" }}
          >
            ⬆️ Up one level
          </button>
        </div>
      </div>

      {/* Content area with a fixed-height container and an overlay loader */}
      <div
        className="chat-history-container"
        style={{
          position: "relative",
          paddingBottom: 40,
          minHeight: 360 // reserve space so layout doesn't jump
        }}
      >
        {/* Non-shifting loader overlay */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1
            }}
          >
            <div className="message-bubble loading-bubble" style={{ background: "#fff", border: "1px solid #e26d6d" }}>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <span style={{ marginLeft: 8, color: "#e26d6d", fontWeight: 600 }}>Loading…</span>
            </div>
          </div>
        )}

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        {/* Folders (always render section) */}
        <h3 style={{ marginTop: 0, color: "#333" }}>📁 Folders</h3>
        {folders.length > 0 ? (
          <div className="faq-grid">
            {folders.map((f) => {
              const name = f.replace(prefix, "").replace(/\/$/, "");
              return (
                <button key={f} className="faq-button" onClick={() => load(f)}>
                  📂 {name}
                </button>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "#777" }}>No subfolders here.</p>
        )}

        {/* Files */}
        <h3 style={{ color: "#333" }}>📑 Files</h3>
        {files.length === 0 ? (
          <p style={{ color: "#777" }}>No files here.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f5f5f5" }}>
                  <th style={{ textAlign: "left", padding: 10 }}>Name</th>
                  <th style={{ textAlign: "right", padding: 10 }}>Size (KB)</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Last Modified</th>
                  <th style={{ padding: 10 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const name = f.key.replace(prefix, "");
                  const sizeKB = (f.size / 1024).toFixed(1);
                  const when = f.lastModified ? new Date(f.lastModified).toLocaleString() : "";
                  return (
                    <tr key={f.key} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: 10 }}>{name}</td>
                      <td style={{ padding: 10, textAlign: "right" }}>{sizeKB}</td>
                      <td style={{ padding: 10 }}>{when}</td>
                      <td style={{ padding: 10 }}>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="send-button"
                          style={{ textDecoration: "none", padding: "6px 14px" }}
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
