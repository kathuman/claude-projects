import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// The browser tests run the real API (a fresh SQLite file per run) serving the built Studio at /app.
// `npm run e2e` builds first. PF_PYTHON points at the backend's Python if it is not the venv's.
const PORT = 8765;
const venv = resolve(here, "../backend/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.PF_PYTHON ?? `"${venv}"`;
const db = join(tmpdir(), `policyforge-e2e-${Date.now()}.db`).replace(/\\/g, "/");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1500, height: 950 }, acceptDownloads: true },
  webServer: {
    command: `${python} -m uvicorn api.app:app --host 127.0.0.1 --port ${PORT}`,
    cwd: "../backend",
    url: `http://127.0.0.1:${PORT}/health`,
    env: { POLICYFORGE_DB: `sqlite:///${db}`, LLM_PROVIDER: "mock" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
