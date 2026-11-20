/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The API's routes, proxied in development so the Studio runs against `uvicorn api.app:app` on port 8000.
const API = ["/health", "/networks", "/schemas", "/scenario-sets", "/scenarios", "/policies", "/evaluations",
  "/constitutions", "/audit"];

export default defineConfig({
  base: "./", // served at /app by the API and at /policyforge/frontend/dist/ on GitHub Pages
  plugins: [react(), tailwindcss()],
  // the schemas and FoodNet are read from ../backend, so the Python models stay the one source of truth
  server: { proxy: Object.fromEntries(API.map((p) => [p, "http://127.0.0.1:8000"])), fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
