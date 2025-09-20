import { useEffect, useMemo, useState } from "react";

/* Local storage keys */
const LS = {
  s3Bucket: "mi_s3_bucket",
  s3Region: "mi_s3_region",
  defaultPrefix: "mi_default_prefix",
  itemsPerPage: "mi_items_per_page",
  theme: "mi_theme",
  rememberLastFolder: "mi_remember_last_folder",
  showSizes: "mi_show_sizes",
  knownPrefixes: "mi_known_prefixes",   // <— from Docs fallback
};

const ENV = {
  s3Bucket: process.env.REACT_APP_S3_BUCKET || "meddoc-raw",
  s3Region: process.env.REACT_APP_S3_REGION || "us-east-1",
  defaultPrefix: process.env.REACT_APP_DEFAULT_PREFIX || "",
  knownPrefixes: (process.env.REACT_APP_KNOWN_FOLDERS || "").split(",").map(s => s.trim()).filter(Boolean),
};

const DEFAULTS = {
  itemsPerPage: 50,
  theme: "light",
  rememberLastFolder: "true",
  showSizes: "true",
};

export default function Settings() {
  const [s3Bucket] = useState(localStorage.getItem(LS.s3Bucket) || ENV.s3Bucket);
  const [s3Region] = useState(localStorage.getItem(LS.s3Region) || ENV.s3Region);

  // working copy (Save to persist)
  const [defaultPrefix, setDefaultPrefix] = useState(localStorage.getItem(LS.defaultPrefix) || ENV.defaultPrefix);
  const [itemsPerPage, setItemsPerPage]   = useState(Number(localStorage.getItem(LS.itemsPerPage) || DEFAULTS.itemsPerPage));
  const [theme, setTheme]                 = useState(localStorage.getItem(LS.theme) || DEFAULTS.theme);
  const [rememberLastFolder, setRememberLastFolder] =
    useState(localStorage.getItem(LS.rememberLastFolder) || DEFAULTS.rememberLastFolder);
  const [showSizes, setShowSizes]         = useState(localStorage.getItem(LS.showSizes) || DEFAULTS.showSizes);

  // “(root)” or “custom”
  const [startMode, setStartMode] = useState(defaultPrefix ? "custom" : "root");

  // folders to show when “custom”
  const [availablePrefixes, setAvailablePrefixes] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // expose env for other pages
  useEffect(() => { localStorage.setItem(LS.s3Bucket, s3Bucket); }, [s3Bucket]);
  useEffect(() => { localStorage.setItem(LS.s3Region, s3Region); }, [s3Region]);

  // preview theme
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme || "light"); }, [theme]);

  // keep prefix coherent with mode
  useEffect(() => { if (startMode === "root") setDefaultPrefix(""); }, [startMode]);

  const s3Base = useMemo(() => `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`, [s3Bucket, s3Region]);
  const NS = "http://s3.amazonaws.com/doc/2006-03-01/";

  // helper: gather “known” prefixes from LS + env in case network listing is blocked
  function getLocalKnown() {
    const fromLS = (localStorage.getItem(LS.knownPrefixes) || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    return Array.from(new Set([...(ENV.knownPrefixes || []), ...fromLS])).sort();
  }

  // Robust root folder discovery
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFolders(true);
        const url = `${s3Base}?list-type=2&delimiter=/`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`S3 list failed ${res.status}`);
        const xml = await res.text();
        const dom = new window.DOMParser().parseFromString(xml, "application/xml");

        const byTag = (parent, tag) => Array.from(parent.getElementsByTagName(tag));
        const byTagNS = (parent, tag) => Array.from(parent.getElementsByTagNameNS(NS, tag));

        // 1) CommonPrefixes (ns + no-ns)
        let cps = byTagNS(dom, "CommonPrefixes");
        if (cps.length === 0) cps = byTag(dom, "CommonPrefixes");

        let prefixes = cps.map(cp => {
          const p = byTagNS(cp, "Prefix")[0] || byTag(cp, "Prefix")[0];
          return (p?.textContent || "").trim();
        }).filter(Boolean);

        // 2) Fallback from Contents keys if no CommonPrefixes
        if (prefixes.length === 0) {
          let contents = byTagNS(dom, "Contents");
          if (contents.length === 0) contents = byTag(dom, "Contents");
          const keys = contents.map(c => {
            const kn = byTagNS(c, "Key")[0] || byTag(c, "Key")[0];
            return (kn?.textContent || "").trim();
          }).filter(Boolean);

          const derived = new Set();
          keys.forEach(k => {
            const i = k.indexOf("/");
            if (i > 0) derived.add(k.slice(0, i + 1));
          });
          prefixes = Array.from(derived).sort();
        }

        // 3) If still empty (root listing blocked), use local known
        if (prefixes.length === 0) prefixes = getLocalKnown();

        if (!cancelled) {
          setAvailablePrefixes(prefixes);
          if (startMode === "custom" && !defaultPrefix && prefixes[0]) {
            setDefaultPrefix(prefixes[0]);
          }
        }
      } catch (e) {
        // network failed: fall back to local known
        if (!cancelled) {
          const local = getLocalKnown();
          setAvailablePrefixes(local);
          if (startMode === "custom" && !defaultPrefix && local[0]) {
            setDefaultPrefix(local[0]);
          }
        }
      } finally {
        if (!cancelled) setLoadingFolders(false);
      }
    })();
    return () => { cancelled = true; };
  }, [s3Base, startMode, defaultPrefix]);

  function savePrefs() {
    localStorage.setItem(LS.defaultPrefix, startMode === "root" ? "" : (defaultPrefix || ""));
    localStorage.setItem(LS.itemsPerPage, String(itemsPerPage || 50));
    localStorage.setItem(LS.theme, theme || "light");
    localStorage.setItem(LS.rememberLastFolder, rememberLastFolder);
    localStorage.setItem(LS.showSizes, showSizes);
    setSavedMsg("✅ Saved");
    setTimeout(() => setSavedMsg(""), 1500);
  }

  function resetDefaults() {
    setStartMode(ENV.defaultPrefix ? "custom" : "root");
    setDefaultPrefix(ENV.defaultPrefix || "");
    setItemsPerPage(DEFAULTS.itemsPerPage);
    setTheme(DEFAULTS.theme);
    setRememberLastFolder(DEFAULTS.rememberLastFolder);
    setShowSizes(DEFAULTS.showSizes);
    setSavedMsg("");
  }

  return (
    <div className="chat-page-container">
      <div className="top-section">
        <h1 className="chat-header">⚙️ Settings</h1>
        <p className="chat-subtitle">Pick your start folder and rows per page. Click <b>Save</b> to apply.</p>
      </div>

      <div className="chat-history-container" style={{ paddingBottom: 40 }}>
        <section style={card}>
          <h3 style={cardTitle}>Browsing defaults</h3>

          <div style={row /* top-aligned */}>
            {/* Start in */}
            <div style={fieldCol}>
              <label style={smallLabel}>Start in</label>
              <select style={select} value={startMode} onChange={(e) => setStartMode(e.target.value)}>
                <option value="root">(root)</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {/* Folder (only when Custom) */}
            {startMode === "custom" && (
              <div style={{ ...fieldCol, minWidth: 260, flex: 1 }}>
                <label style={smallLabel}>Folder</label>
                <select
                  style={select}
                  value={defaultPrefix && !defaultPrefix.endsWith("/") ? defaultPrefix + "/" : (defaultPrefix || "")}
                  onChange={(e) => setDefaultPrefix(e.target.value)}
                >
                  {loadingFolders && <option value="">Loading…</option>}
                  {!loadingFolders && availablePrefixes.length === 0 && <option value="">(no folders found)</option>}
                  {defaultPrefix && availablePrefixes.indexOf(defaultPrefix) < 0 && (
                    <option value={defaultPrefix}>{defaultPrefix}</option>
                  )}
                  {availablePrefixes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <p style={hint}>Docs will open here unless “remember last folder” is on.</p>
              </div>
            )}

            {/* Rows per page */}
            <div style={fieldCol}>
              <label style={smallLabel}>Rows per page</label>
              <input
                type="number" min={1} max={500} step={1}
                style={{ ...input, width: 140 }}
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(Number(e.target.value || 0))}
              />
              <p style={{ ...hint, maxWidth: 240 }}>How many file rows to show per page in Docs.</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <label style={checkbox}>
              <input type="checkbox" checked={rememberLastFolder === "true"}
                onChange={(e) => setRememberLastFolder(e.target.checked ? "true" : "false")} />
              &nbsp;Remember last folder in Docs
            </label>
            <label style={checkbox}>
              <input type="checkbox" checked={showSizes === "true"}
                onChange={(e) => setShowSizes(e.target.checked ? "true" : "false")} />
              &nbsp;Show file sizes
            </label>
          </div>
        </section>

        <section style={card}>
          <h3 style={cardTitle}>Theme</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="faq-button" onClick={() => setTheme("light")} disabled={theme === "light"}>☀️ Light</button>
            <button className="faq-button" onClick={() => setTheme("dark")}  disabled={theme === "dark"}>🌙 Dark</button>
            <span style={{ marginLeft: 8, color: "var(--text-muted, #555)" }}>Previewed now; saved on “Save”.</span>
          </div>
        </section>

        <section style={card}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="send-button" onClick={savePrefs} style={{ padding: "8px 18px" }}>Save</button>
            <button className="faq-button" onClick={resetDefaults}>Reset to defaults</button>
            {savedMsg && <span style={{ color: "green", fontWeight: 600 }}>{savedMsg}</span>}
          </div>
        </section>
      </div>
    </div>
  );
}

/* styles */
const card = { background: "var(--card-bg, #fff)", border: "1px solid var(--card-border, #eee)", borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const cardTitle = { marginTop: 0, color: "var(--text-strong, #333)" };
const row = { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" };
const fieldCol = { display: "flex", flexDirection: "column", gap: 6 };
const input = { padding: "10px 12px", borderRadius: 12, border: "1px solid var(--input-border, #ddd)", minWidth: 140, outline: "none", background: "var(--input-bg, #f5f5f5)", color: "var(--text, #222)" };
const select = {
  ...input, minWidth: 160, appearance: "none",
  backgroundImage: "linear-gradient(45deg, transparent 50%, #888 50%), linear-gradient(135deg, #888 50%, transparent 50%), linear-gradient(to right, transparent, transparent)",
  backgroundPosition: "calc(100% - 20px) calc(1em + 2px), calc(100% - 15px) calc(1em + 2px), 0 0",
  backgroundRepeat: "no-repeat", backgroundSize: "5px 5px, 5px 5px, 2.5em 2.5em",
};
const smallLabel = { display: "block", marginBottom: 2, color: "var(--text-muted, #555)", fontSize: 14 };
const hint = { color: "var(--text-subtle, #777)" };
const checkbox = { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text, #333)" };
