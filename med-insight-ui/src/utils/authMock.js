// super-lightweight mock auth for demo purposes only
const LS_USER = "mi_user";

export function getUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || "null"); }
  catch { return null; }
}

export function loginMock({ email, password }) {
  if (!email || !password) return { ok: false, error: "Email and password required." };
  const user = { name: email.split("@")[0], email };
  localStorage.setItem(LS_USER, JSON.stringify(user));
  return { ok: true, user };
}

export function registerMock({ name, email, password }) {
  if (!name || !email || !password) return { ok: false, error: "All fields required." };
  const user = { name, email };
  localStorage.setItem(LS_USER, JSON.stringify(user)); // auto-login for demo
  return { ok: true, user };
}

export function logoutMock() {
  localStorage.removeItem(LS_USER);
}
