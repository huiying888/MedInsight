import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Brand from "../components/Brand";
import { registerMock } from "../utils/authMock";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  function onSubmit(e) {
    e.preventDefault();
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (password !== confirm) return setErr("Passwords do not match.");
    const res = registerMock({ name, email, password });
    if (!res.ok) return setErr(res.error || "Registration failed.");
    nav("/", { replace: true }); // auto-login on success
  }

  return (
    <div className="chat-page-container">
      <div className="top-section" style={{ textAlign: "center" }}>
        <Brand size={56} />
        <h1 className="chat-header">Create your account</h1>
        <p className="chat-subtitle">Mock registration (saves to localStorage).</p>
      </div>

      <form onSubmit={onSubmit} style={card}>
        <label style={label}>Full name</label>
        <input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Dr. Jane Doe" required />

        <label style={label}>Email</label>
        <input style={input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@clinic.my" required />

        <label style={label}>Password</label>
        <input style={input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Min 6 characters" required />

        <label style={label}>Confirm password</label>
        <input style={input} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat password" required />

        {err && <p style={{ color: "crimson", marginTop: 8 }}>{err}</p>}

        <button className="send-button" type="submit" style={{ padding: "10px 18px", marginTop: 10 }}>
          Create account
        </button>

        <p style={{ marginTop: 12 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

const card  = { maxWidth: 480, margin: "0 auto", background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: 16 };
const input = { padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", outline: "none", background: "#f5f5f5", width: "100%", marginBottom: 10 };
const label = { fontSize: 14, color: "#444", margin: "6px 0" };
