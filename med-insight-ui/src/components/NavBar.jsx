import { NavLink } from "react-router-dom";

const linkStyle = ({ isActive }) => ({
  padding: "8px 12px",
  margin: "0 4px",
  borderRadius: "6px",
  textDecoration: "none",
  color: isActive ? "#fff" : "#333",
  background: isActive ? "#e26d6d" : "transparent",
});

export default function NavBar() {
  return (
    <nav style={{ padding: "12px", borderBottom: "1px solid #eee" }}>
      <NavLink to="/" style={linkStyle} end>
        Home
      </NavLink>
      <NavLink to="/chat" style={linkStyle}>
        Chat
      </NavLink>
      <NavLink to="/upload" style={linkStyle}>
        Upload
      </NavLink>
      <NavLink to="/docs" style={linkStyle}>
        Docs
      </NavLink>
      <NavLink to="/settings" style={linkStyle}>
        Settings
      </NavLink>
      <NavLink to="/about" style={linkStyle}>
        About
      </NavLink>
    </nav>
  );
}
