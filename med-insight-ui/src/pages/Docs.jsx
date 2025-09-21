import { useEffect, useMemo, useState } from "react";

const BUCKET = process.env.REACT_APP_S3_BUCKET || "meddoc-raw";
const REGION = process.env.REACT_APP_S3_REGION || "us-east-1";
const S3_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
const NS = "http://s3.amazonaws.com/doc/2006-03-01/";

const LS = {
  defaultPrefix: "mi_default_prefix",
  rememberLastFolder: "mi_remember_last_folder",
  itemsPerPage: "mi_items_per_page",
  showSizes: "mi_show_sizes",
  lastPrefix: "mi_docs_last_prefix",
};

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

  // namespaced + non-namespaced fallback
  let cps = Array.from(dom.getElementsByTagNameNS(NS, "CommonPrefixes"));
  if (cps.length === 0) cps = Array.from(dom.getElementsByTagName("CommonPrefixes"));

  const folders = cps.map(cp => {
    const node = cp.getElementsByTagNameNS(NS, "Prefix")[0] || cp.getElementsByTagName("Prefix")[0];
    return (node?.textContent || "").trim();
  }).filter(Boolean);

  let files = Array.from(dom.getElementsByTagNameNS(NS, "Contents"));
  if (files.length === 0) files = Array.from(dom.getElementsByTagName("Contents"));

  files = files.map(c => {
    const keyNode = c.getElementsByTagNameNS(NS, "Key")[0] || c.getElementsByTagName("Key")[0];
    const sizeNode = c.getElementsByTagNameNS(NS, "Size")[0] || c.getElementsByTagName("Size")[0];
    const lmNode   = c.getElementsByTagNameNS(NS, "LastModified")[0] || c.getElementsByTagName("LastModified")[0];
    const key = (keyNode?.textContent || "").trim();
    return {
      key,
      size: Number((sizeNode?.textContent || "0").trim()),
      lastModified: (lmNode?.textContent || "").trim(),
    };
  });

  // remove folder markers
  files = files.filter(f => !(f.key.endsWith("/") && f.size === 0));
  // link
  files = files.map(f => ({ ...f, url: `${S3_BASE}/${encodeURIComponent(f.key).replace(/%2F/g, "/")}` }));

  return { folders, files };
}

export default function Docs() {
  // read saved prefs
  const rememberLast = (localStorage.getItem(LS.rememberLastFolder) || "true") === "true";
  const defaultPrefixPref = localStorage.getItem(LS.defaultPrefix) || "";
  const rowsPerPage = Math.max(1, Math.min(500, Number(localStorage.getItem(LS.itemsPerPage) || 50)));
  const showSizes = (localStorage.getItem(LS.showSizes) || "true") === "true";

  const initialPrefix = rememberLast
    ? (localStorage.getItem(LS.lastPrefix) ?? defaultPrefixPref ?? "")
    : (defaultPrefixPref ?? "");

  const [prefix, setPrefix] = useState(initialPrefix || "");
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // pagination
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(files.length / rowsPerPage));
  const pagedFiles = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return files.slice(start, start + rowsPerPage);
  }, [files, page, rowsPerPage]);

  const crumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    return [{ label: "root", pfx: "" }, ...parts.map((p, i) => ({ label: p, pfx: parts.slice(0, i + 1).join("/") + "/" }))];
  }, [prefix]);

  async function load(pfx = "") {
    setLoading(true);
    setErr("");
    try {
      const { folders, files } = await listS3(pfx);
      setFolders(folders);
      setFiles(files);
      setPrefix(pfx);
      setPage(1);
      localStorage.setItem("mi_docs_last_prefix", pfx);

      // ---- NEW: remember top-level prefixes for Settings fallback ----
      const known = new Set(
        (localStorage.getItem("mi_known_prefixes") || "").split(",").map(s => s.trim()).filter(Boolean)
      );

      // from current prefix
      if (pfx) {
        const top = pfx.split("/")[0];
        if (top) known.add(top + "/");
      }

      // from folders in this view
      folders.forEach(f => {
        const seg = f.split("/")[0];
        if (seg) known.add(seg + "/");
      });

      // from files in this view
      files.forEach(f => {
        const seg = f.key.split("/")[0];
        if (seg) known.add(seg + "/");
      });

      localStorage.setItem("mi_known_prefixes", Array.from(known).sort().join(","));
      // ----------------------------------------------------------------
    } catch (e) {
      console.error(e);
      setErr("❌ Failed to load from S3. Check bucket policy & CORS.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(prefix); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="chat-page-container">
      <div className="top-section">
        <h1 className="chat-header">📂 Bucket Browser</h1>
        <p className="chat-subtitle">Browsing {BUCKET} in {REGION}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 500, color: "var(--text-strong, #333)" }}>
            {crumbs.map((c, i) => (
              <span key={c.pfx}>
                <a href="#!" onClick={() => load(c.pfx)} style={{ color: "#e26d6d", textDecoration: "none" }}>{c.label}</a>
                {i < crumbs.length - 1 ? " / " : ""}
              </span>
            ))}
          </div>

          <button className="faq-button" onClick={() => load(parentPrefix(prefix))} disabled={!prefix} style={{ padding: "0.5em 0.9em" }}>
            ⬆️ Up one level
          </button>

          <button className="faq-button" onClick={() => load(defaultPrefixPref || "")} disabled={(defaultPrefixPref || "") === prefix} style={{ padding: "0.5em 0.9em" }}>
            📌 Go to default
          </button>
        </div>
      </div>

      <div className="chat-history-container" style={{ position: "relative", paddingBottom: 80, minHeight: 360 }}>
        {loading && (
          <div style={{position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(46, 46, 46, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
            <div className="message-bubble loading-bubble" style={{ background: "var(--card-bg, #fff)", border: "1px solid #e26d6d" }}>
              <div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" />
              <span style={{ marginLeft: 8, color: "#e26d6d", fontWeight: 600 }}>Loading…</span>
            </div>
          </div>
        )}

        {err && <p style={{ color: "crimson" }}>{err}</p>}

        <h3 style={{ marginTop: 0, color: "var(--text-strong, #333)" }}>📁 Folders</h3>
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
          <p style={{ color: "var(--text-subtle, #777)" }}>No subfolders here.</p>
        )}

        <h3 style={{ color: "var(--text-strong, #333)" }}>📑 Files</h3>
        {files.length === 0 ? (
          <p style={{ color: "var(--text-subtle, #777)" }}>No files here.</p>
        ) : (
          <>
            <div style={{ overflowX: "auto" /* horizontal only – no inner vertical scroll */, overflowY: "visible" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--table-head, #f5f5f5)" }}>
                    <th style={{ textAlign: "left", padding: 10 }}>Name</th>
                    {showSizes && <th style={{ textAlign: "right", padding: 10 }}>Size (KB)</th>}
                    <th style={{ textAlign: "left", padding: 10 }}>Last Modified</th>
                    <th style={{ padding: 10 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedFiles.map((f) => {
                    const name = f.key.replace(prefix, "");
                    const sizeKB = (f.size / 1024).toFixed(1);
                    const when = f.lastModified ? new Date(f.lastModified).toLocaleString() : "";
                    return (
                      <tr key={f.key} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: 10 }}>{name}</td>
                        {showSizes && <td style={{ padding: 10, textAlign: "right" }}>{sizeKB}</td>}
                        <td style={{ padding: 10 }}>{when}</td>
                        <td style={{ padding: 10 }}>
                          <a href={f.url} target="_blank" rel="noreferrer" className="send-button" style={{ textDecoration: "none", padding: "6px 14px" }}>
                            Open
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 12 }}>
              <button className="faq-button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>◀ Prev</button>
              <span style={{ alignSelf: "center", color: "var(--text, #333)" }}>
                Page {page} / {totalPages} · {files.length} files · {rowsPerPage} rows/page
              </span>
              <button className="faq-button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next ▶</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
