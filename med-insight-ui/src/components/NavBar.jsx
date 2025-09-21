// src/components/NavBar.jsx (small tweak)
import { NavLink, Link, useNavigate } from "react-router-dom";
import Brand from "./Brand";
import { getUser, logoutMock } from "../utils/authMock";

const linkStyle = ({ isActive }) => ({
  padding: "8px 12px",
  margin: "0 4px",
  borderRadius: "8px",
  textDecoration: "none",
  color: isActive ? "var(--nav-active-text)" : "var(--nav-text)",
  background: isActive ? "var(--nav-active-bg)" : "transparent",
});


export default function NavBar(){
  const user = getUser();
  const nav = useNavigate();
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        padding: "10px 16px",
        borderBottom: "1px solid var(--card-border)",
        background: "var(--nav-bg)",
        color: "var(--nav-text)",
        backdropFilter: "saturate(120%) blur(6px)",
      }}
    >
      <div style={{ display:"flex", alignItems:"center", gap:16, maxWidth:1200, margin:"0 auto" }}>
        <Brand size={28} />
        <div style={{ display:"flex", flexWrap:"wrap", gap:4, flex:1 }}>
          <NavLink to="/" style={linkStyle} end>Home</NavLink>
          <NavLink to="/chat" style={linkStyle}>Chat</NavLink>
          <NavLink to="/upload" style={linkStyle}>Upload</NavLink>
          <NavLink to="/docs" style={linkStyle}>Docs</NavLink>
          <NavLink to="/settings" style={linkStyle}>Settings</NavLink>
          <NavLink to="/about" style={linkStyle}>About</NavLink>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {!user ? (
            <>
              <Link to="/login" style={btn}>Login</Link>
              <Link to="/register" style={{ ...btn, background:"#e26d6d", color:"#fff", borderColor:"#e26d6d" }}>Register</Link>
            </>
          ) : (
            <>
              <span style={{ color:"#555", fontWeight:600 }}>{user.name || user.email}</span>
              <button
                onClick={() => { logoutMock(); nav("/login"); }}
                style={btn}
                className="logout-btn"
              >
                Logout
              </button>

            </>
          )}
        </div>
      </div>
    </nav>
  );
}
const btn = { padding:"8px 12px", borderRadius:10, border:"1px solid #ddd", background:"#f5f5f5" };
