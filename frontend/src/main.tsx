import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import App from "./App";
import "./styles.css";

// The pre-React service worker used these caches; remove them so they don't linger after upgrading.
if ("caches" in window) {
  void caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key.startsWith("cartchef-v1-")).map((key) => caches.delete(key))),
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
