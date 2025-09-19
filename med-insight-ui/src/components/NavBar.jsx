import { NavLink } from "react-router-dom";

const linkStyle = ({ isActive }) => ({
  padding: "8px 12px",
  margin: "0 4px",
  borderRadius: "6px",
  textDecoration: "none",
  color: isActive ? "var(--nav-active-text, #fff)" : "var(--nav-text, #333)",
  background: isActive ? "var(--nav-active-bg, #e26d6d)" : "transparent",
});

export default function NavBar() {
  return (
    <nav
      style={{
        position: "sticky",   // stays at top while scrolling
        top: 0,
        zIndex: 1000,
        padding: "12px",
        borderBottom: "1px solid var(--card-border, #eee)",
        background: "var(--nav-bg, #fff)",
        backdropFilter: "saturate(120%) blur(4px)",
      }}
    >
      <NavLink to="/" style={linkStyle} end>Home</NavLink>
      <NavLink to="/chat" style={linkStyle}>Chat</NavLink>
      <NavLink to="/upload" style={linkStyle}>Upload</NavLink>
      <NavLink to="/docs" style={linkStyle}>Docs</NavLink>
      <NavLink to="/settings" style={linkStyle}>Settings</NavLink>
      <NavLink to="/about" style={linkStyle}>About</NavLink>
    </nav>
  );
}
