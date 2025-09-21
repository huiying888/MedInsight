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
  knownPrefixes: "mi_known_prefixes",
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

  // name-spaced + fallback
  let cps = Array.from(dom.getElementsByTagNameNS(NS, "CommonPrefixes"));
  if (cps.length === 0) cps = Array.from(dom.getElementsByTagName("CommonPrefixes"));

  const folders = cps
    .map((cp) => {
      const node = cp.getElementsByTagNameNS(NS, "Prefix")[0] || cp.getElementsByTagName("Prefix")[0];
      return (node?.textContent || "").trim();
    })
    .filter(Boolean);

  let files = Array.from(dom.getElementsByTagNameNS(NS, "Contents"));
  if (files.length === 0) files = Array.from(dom.getElementsByTagName("Contents"));

  files = files.map((c) => {
    const keyNode = c.getElementsByTagNameNS(NS, "Key")[0] || c.getElementsByTagName("Key")[0];
    const sizeNode = c.getElementsByTagNameNS(NS, "Size")[0] || c.getElementsByTagName("Size")[0];
    const lmNode = c.getElementsByTagNameNS(NS, "LastModified")[0] || c.getElementsByTagName("LastModified")[0];
    const key = (keyNode?.textContent || "").trim();
    return {
      key,
      size: Number((sizeNode?.textContent || "0").trim()),
      lastModified: (lmNode?.textContent || "").trim(),
    };
  });

  // remove folder markers
  files = files.filter((f) => !(f.key.endsWith("/") && f.size === 0));
  // link
  files = files.map((f) => ({
    ...f,
    url: `${S3_BASE}/${encodeURIComponent(f.key).replace(/%2F/g, "/")}`,
  }));

  return { folders, files };
}

export default function Docs() {
  // prefs
  const rememberLast = (localStorage.getItem(LS.rememberLastFolder) || "true") === "true";
  const defaultPrefixPref = localStorage.getItem(LS.defaultPrefix) || "";
  const rowsPerPage = Math.max(1, Math.min(500, Number(localStorage.getItem(LS.itemsPerPage) || 50)));
  const showSizes = (localStorage.getItem(LS.showSizes) || "true") === "true";

  const initialPrefix = rememberLast
    ? localStorage.getItem(LS.lastPrefix) ?? defaultPrefixPref ?? ""
    : defaultPrefixPref ?? "";

  const [prefix, setPrefix] = useState(initialPrefix || "");
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // explorer UI state
  const [filter, setFilter] = useState("");
  const [view, setView] = useState("list"); // 'list' | 'grid'
  const [sortKey, setSortKey] = useState("name"); // 'name' | 'size' | 'date'
  const [sortDir, setSortDir] = useState("asc"); // 'asc' | 'desc'

  // pagination
  const [page, setPage] = useState(1);

  // sidebar known prefixes (quick access)
  const knownPrefixes = useMemo(() => {
    const raw = (localStorage.getItem(LS.knownPrefixes) || "").split(",").map(s => s.trim()).filter(Boolean);
    const set = new Set(raw);
    // include current and default if missing
    if (prefix) set.add(prefix.split("/")[0] + "/");
    if (defaultPrefixPref) set.add(defaultPrefixPref.split("/")[0] + "/");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [prefix, defaultPrefixPref]);

  const totalPages = Math.max(1, Math.ceil(files.length / rowsPerPage));

  async function load(pfx = "") {
    setLoading(true);
    setErr("");
    try {
      const { folders, files } = await listS3(pfx);
      setFolders(folders);
      setFiles(files);
      setPrefix(pfx);
      setPage(1);
      localStorage.setItem(LS.lastPrefix, pfx);

      // remember top-level prefixes for quick access
      const known = new Set(
        (localStorage.getItem(LS.knownPrefixes) || "").split(",").map((s) => s.trim()).filter(Boolean)
      );
      if (pfx) {
        const top = pfx.split("/")[0];
        if (top) known.add(top + "/");
      }
      folders.forEach((f) => {
        const seg = f.split("/")[0];
        if (seg) known.add(seg + "/");
      });
      files.forEach((f) => {
        const seg = f.key.split("/")[0];
        if (seg) known.add(seg + "/");
      });
      localStorage.setItem(LS.knownPrefixes, Array.from(known).sort().join(","));
    } catch (e) {
      console.error(e);
      setErr("❌ Failed to load from S3. Check bucket policy & CORS.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(prefix); // initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // filtering + sorting
  const filteredFolders = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return folders
      .map((fp) => ({ full: fp, name: fp.replace(prefix, "").replace(/\/$/, "") }))
      .filter((x) => (f ? x.name.toLowerCase().includes(f) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, prefix, filter]);

  const sortedFilteredFiles = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let list = files
      .map((file) => {
        const name = file.key.replace(prefix, "");
        return { ...file, name };
      })
      .filter((x) => (f ? x.name.toLowerCase().includes(f) : true));

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "size") {
        cmp = a.size - b.size;
      } else if (sortKey === "date") {
        cmp = new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime();
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [files, prefix, filter, sortKey, sortDir]);

  const pagedFiles = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return sortedFilteredFiles.slice(start, start + rowsPerPage);
  }, [sortedFilteredFiles, page, rowsPerPage]);

  // UI handlers
  const onOpenFolder = (pfx) => load(pfx);
  const onUp = () => load(parentPrefix(prefix));
  const onRefresh = () => load(prefix);
  const gotoDefault = () => load(defaultPrefixPref || "");

  const crumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    return [{ label: "root", pfx: "" }, ...parts.map((p, i) => ({ label: p, pfx: parts.slice(0, i + 1).join("/") + "/" }))];
  }, [prefix]);

  return (
    <div className="docs-explorer">
      {/* Sidebar */}
      <aside className="docs-sidebar">
        <div className="docs-side-head">
          <div className="docs-bucket">🪣 {BUCKET}</div>
          <div className="docs-region">Region: <code>{REGION}</code></div>
        </div>

        <div className="docs-side-actions">
          <button className="faq-button" onClick={() => load("")}>🏠 Root</button>
          <button className="faq-button" onClick={gotoDefault} disabled={(defaultPrefixPref || "") === prefix}>📌 Default</button>
          <button className="faq-button" onClick={onUp} disabled={!prefix}>⬆️ Up</button>
          <button className="faq-button" onClick={onRefresh}>🔄 Refresh</button>
        </div>

        <div className="docs-side-group">
          <div className="docs-side-title">Quick access</div>
          <div className="docs-side-list">
            {knownPrefixes.length === 0 ? (
              <div className="docs-muted">No known prefixes yet.</div>
            ) : (
              knownPrefixes.map((p) => (
                <button
                  key={p}
                  className={`docs-side-item ${prefix.startsWith(p) ? "active" : ""}`}
                  onClick={() => load(p)}
                  title={p}
                >
                  <span className="folder-emoji">📂</span> {p}
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <section className="docs-main">
        {/* Top bar */}
        <div className="docs-topbar">
          <div className="docs-crumbs">
            {crumbs.map((c, i) => (
              <span key={c.pfx}>
                <a href="#!" onClick={() => onOpenFolder(c.pfx)} className="docs-crumb-link">{c.label}</a>
                {i < crumbs.length - 1 ? <span className="docs-crumb-sep"> / </span> : null}
              </span>
            ))}
          </div>

          <div className="docs-controls">
            <input
              className="docs-search"
              placeholder="Filter by name…"
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            />
            <select className="docs-select" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="list">List view</option>
              <option value="grid">Grid view</option>
            </select>
            <select className="docs-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="size">Sort: Size</option>
              <option value="date">Sort: Date</option>
            </select>
            <select className="docs-select" value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </select>
          </div>
        </div>

        {/* Folders */}
        <div className={`docs-folders ${view}`}>
          {filteredFolders.length === 0 ? (
            <div className="docs-empty">No subfolders.</div>
          ) : view === "grid" ? (
            <div className="folder-grid">
              {filteredFolders.map((f) => (
                <button
                  key={f.full}
                  className="folder-card"
                  onClick={() => onOpenFolder(f.full)}
                  title={f.full}
                >
                  <div className="folder-icon">📁</div>
                  <div className="folder-name" title={f.name}>{f.name}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="folder-list">
              {filteredFolders.map((f) => (
                <button
                  key={f.full}
                  className="folder-row"
                  onClick={() => onOpenFolder(f.full)}
                  title={f.full}
                >
                  <span className="folder-emoji">📂</span>
                  <span className="folder-name" title={f.name}>{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Files */}
        {sortedFilteredFiles.length === 0 ? (
          <div className="docs-empty">No files in this folder.</div>
        ) : view === "grid" ? (
          <div className="file-grid">
            {pagedFiles.map((f) => {
              const sizeKB = (f.size / 1024).toFixed(1);
              return (
                <a key={f.key} href={f.url} target="_blank" rel="noreferrer" className="file-card" title={f.name}>
                  <div className="file-icon">📄</div>
                  <div className="file-name" title={f.name}>{f.name}</div>
                  <div className="file-meta">
                    {showSizes && <span>{sizeKB} KB</span>}
                    <span>{f.lastModified ? new Date(f.lastModified).toLocaleString() : ""}</span>
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <div className="file-table-wrap">
            <table className="file-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {showSizes && <th style={{ textAlign: "right" }}>Size (KB)</th>}
                  <th>Last Modified</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedFiles.map((f) => {
                  const sizeKB = (f.size / 1024).toFixed(1);
                  const when = f.lastModified ? new Date(f.lastModified).toLocaleString() : "";
                  return (
                    <tr key={f.key}>
                      <td>{f.name}</td>
                      {showSizes && <td style={{ textAlign: "right" }}>{sizeKB}</td>}
                      <td>{when}</td>
                      <td>
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
        )}

        {/* Pagination */}
        {sortedFilteredFiles.length > rowsPerPage && (
          <div className="docs-pager">
            <button className="faq-button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              ◀ Prev
            </button>
            <span className="docs-page-label">
              Page {page} / {totalPages} · {sortedFilteredFiles.length} files · {rowsPerPage} rows/page
            </span>
            <button className="faq-button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next ▶
            </button>
          </div>
        )}
      </section>

      {/* Fullscreen loading overlay */}
      {loading && (
        <div className="docs-loading">
          <div className="message-bubble loading-bubble" style={{ background: "var(--card-bg)", border: "1px solid #e26d6d" }}>
            <div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" />
            <span style={{ marginLeft: 8, color: "#e26d6d", fontWeight: 600 }}>Loading…</span>
          </div>
        </div>
      )}

      {/* Error */}
      {err && <div className="docs-error">{err}</div>}
    </div>
  );
}
