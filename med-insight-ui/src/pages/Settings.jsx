import { useEffect, useState } from "react";

export default function Settings() {
  const [api, setApi] = useState(localStorage.getItem("apiUrl") || (process.env.REACT_APP_API_URL || ""));

  useEffect(() => {
    if (api) localStorage.setItem("apiUrl", api);
  }, [api]);

  return (
    <section style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h2>Settings</h2>
      <label style={{ display:"block", margin: "12px 0 6px" }}>API Gateway URL</label>
      <input
        style={{ width: "100%", padding: 10 }}
        value={api}
        onChange={(e) => setApi(e.target.value)}
        placeholder="https://<api-id>.execute-api.ap-southeast-5.amazonaws.com/prod/query"
      />
      <p style={{ color: "#666", marginTop: 8 }}>Saved in localStorage for this browser.</p>
    </section>
  );
}
