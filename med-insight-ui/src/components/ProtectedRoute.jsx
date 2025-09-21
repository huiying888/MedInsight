// src/components/ProtectedRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getUser } from "../utils/authMock";

export default function ProtectedRoute() {
  const user = getUser();
  const loc = useLocation();
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
}
