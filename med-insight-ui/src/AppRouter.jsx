import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Upload from "./pages/Upload";
import Docs from "./pages/Docs";
import Settings from "./pages/Settings";
import About from "./pages/About";
import NotFound from "./pages/NotFound";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* everything wrapped inside AppLayout (nav + footer) */}
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="chat" element={<Chat />} />
          <Route path="upload" element={<Upload />} />
          <Route path="docs" element={<Docs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="about" element={<About />} />
          {/* optional redirect /home -> / */}
          <Route path="home" element={<Navigate to="/" replace />} />
        </Route>

        {/* catch-all for 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
