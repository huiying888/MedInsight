import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import Brand from "../components/Brand";
import { loginMock } from "../utils/authMock";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from || "/";

  async function onSubmit(e) {
    e.preventDefault();
    const res = loginMock({ email, password });
    if (!res.ok) return setErr(res.error || "Login failed.");
    nav("/", { replace: true });
  }

  return (
    <div className="chat-page-container">
      <div className="top-section" style={{ textAlign: "center" }}>
        <Brand size={56} />
        <h1 className="chat-header">Welcome back</h1>
      </div>

      <form onSubmit={onSubmit} style={card}>
        <label style={label}>Email</label>
        <input style={input} type="email" placeholder="you@clinic.my" value={email} onChange={e=>setEmail(e.target.value)} required />
        <br/>
        <label style={label}>Password</label>
        <input style={input} type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required />
        <br/>
        {err && <p style={{ color: "crimson", marginTop: 8 }}>{err}</p>}
        <br/>
        <button className="send-button" type="submit" style={{ padding: "10px 18px", marginTop: 10 }}>
          Sign in
        </button>

        <p style={{ marginTop: 12 }}>
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </div>
  );
}

const card  = { maxWidth: 420, margin: "0 auto", background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: 16, width: "50%" };
const input = { padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", outline: "none", background: "#f5f5f5", width: "75%", marginBottom: 10 };
const label = { fontSize: 14, color: "#444", margin: "6px 0", display: "inline-block", width: "150px"};
