import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";

export function NotFound() {
  usePageTitle("Not found");
  return (
    <div className="error-page">
      <p className="error-code">404</p>
      <h1>We couldn't find that page.</h1>
      <Link className="btn btn-primary" to="/">Back to recipes</Link>
    </div>
  );
}
