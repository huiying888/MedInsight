import { Link } from "react-router-dom";
export default function NotFound() {
  return (
    <section style={{ padding: 24 }}>
      <h2>404</h2>
      <p>That page doesn’t exist. <Link to="/">Go home</Link>.</p>
    </section>
  );
}
