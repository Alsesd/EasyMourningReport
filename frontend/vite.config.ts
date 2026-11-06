/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Go binary serves the production bundle from /static/app/; the dev server serves the app at /
// and forwards only backend-owned paths. BACKEND_URL points the proxy at another backend port.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
// Keep the Host header: the backend's same-origin guard compares it with the browser's Origin.
const toBackend = { target: backend, changeOrigin: false };

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/static/app/" : "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../internal/assets/static/app",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": toBackend,
      "/healthz": toBackend,
      "/manifest.webmanifest": toBackend,
      // Icons and other backend static files, but not the app bundle (Vite serves that in dev).
      "^/static/(?!app/)": toBackend,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
}));
