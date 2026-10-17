import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import pkg from "./package.json" with { type: "json" };

/** {version, number, time, sha}: the foot of the sidebar shows "v0.1.0 #128" (folded) or all of it, to tell
 *  deployments apart. `number` counts commits, so it only goes up; the server build gets it as BUILD_NUMBER. */
function buildInfo() {
  const t = new Date(Date.now() + 7 * 3600e3).toISOString();          // Vietnam time
  const time = `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}`;
  let sha = process.env.GIT_SHA ?? "";
  let number = process.env.BUILD_NUMBER ?? "";
  try {
    const git = (a: string) => execSync(`git ${a}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    sha ||= git("rev-parse --short HEAD") + (git("status --porcelain") ? "*" : "");   // * = built with uncommitted changes
    number ||= git("rev-list --count HEAD");
  } catch { /* no git (docker build): the args above */ }
  return { version: pkg.version, number, time, sha };
}

// The browser only ever talks to /api on its own origin: Vite proxies it in dev, nginx (or FastAPI) in prod,
// so the session cookie stays first-party and there is no CORS.
const API = process.env.API_URL ?? "http://127.0.0.1:8001";     // dev API port (8000 is the Docker one)

export default defineConfig({
  plugins: [react(), tailwind()],
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
