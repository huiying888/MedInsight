import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./AppRouter";
import "./App.css";

// Apply theme before first paint (defaults to light)
try {
  const saved = localStorage.getItem("mi_theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
} catch {}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);
