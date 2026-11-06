import { captureInstallPrompt } from "@/platform/device/installPrompt";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// After the program updates itself, an open tab still points at chunk files of the old build. Vite reports the
// failed load; reloading fetches the new build.
window.addEventListener("vite:preloadError", () => window.location.reload());

captureInstallPrompt();

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
