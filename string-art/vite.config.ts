import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The AI Projects site is served by GitHub Pages straight from the repository, with no build step. So the page's
// source lives in web/ (index.html loads src/ as TypeScript during development), and `npm run build` writes the
// finished static page to app/, which is committed and served. base "./" keeps every URL relative, so the build
// works from …/claude-projects/string-art/app/. CI rebuilds and checks that app/ matches the source.
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "web",
  base: "./",
  build: {
    outDir: "../app", emptyOutDir: true, target: "es2022", sourcemap: false,
    rollupOptions: { input: { main: here + "web/index.html", about: here + "web/about.html" } }
  },
  worker: { format: "es" },
  test: { root: here, include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 120_000 }
} as Parameters<typeof defineConfig>[0]);
