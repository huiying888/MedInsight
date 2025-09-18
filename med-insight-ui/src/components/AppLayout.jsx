import { Outlet } from "react-router-dom";
import NavBar from "./NavBar";

export default function AppLayout() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        fontFamily: "sans-serif",
      }}
    >
      {/* top navigation */}
      <NavBar />

      {/* main content area */}
      <main style={{ flex: 1, padding: "20px" }}>
        <Outlet />
      </main>

      {/* footer */}
      <footer style={{ padding: "12px", textAlign: "center", color: "#666" }}>
        © {new Date().getFullYear()} MediInsightAI
      </footer>
    </div>
  );
}
