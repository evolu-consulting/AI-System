// HUB-FR-72 · H4a-AC-11 · plan P12, §5.4 · phục vụ bản build Studio ở `/studio` (cùng origin với `/studio/api`).
// Mount SAU route API: `/studio/api/*` không bao giờ rơi vào SPA fallback (route API khớp trước; path lạ ⇒ 404 JSON).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Context, Env, Hono } from "hono";
import { serveStatic } from "hono/bun";
import { toErrorBody } from "../../lib/errors";

const BASE = "/studio";
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};
const IMMUTABLE = "public, max-age=31536000, immutable";

/** `/studio/api` và mọi đường con thuộc API, không thuộc phần tĩnh. */
export const isStudioApiPath = (path: string): boolean =>
  path === `${BASE}/api` || path.startsWith(`${BASE}/api/`);

/** Lưới thứ hai ngoài `serveStatic`: `..` hoặc `%2e%2e` (mọi kiểu hoa/thường) ở đường dẫn thô ⇒ 404. */
export const isTraversal = (rawPath: string): boolean => {
  const p = rawPath.toLowerCase();
  return p.includes("..") || p.includes("%2e%2e") || p.includes("%2e.") || p.includes(".%2e");
};

/** Đoạn cuối có đuôi (`app.js`, `x.png`) ⇒ là file: không thấy thì 404, không trả `index.html`. */
export const hasExtension = (path: string): boolean =>
  /\.[^/]+$/.test(path.split("/").at(-1) ?? "");

/** `dir` có `index.html` ⇒ dùng được làm dist Studio. */
export const isStudioDist = (dir: string | undefined): dir is string =>
  dir !== undefined && existsSync(join(dir, "index.html"));

function secure(c: Context): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
}

/** Gọi khi `isStudioDist(dist)`; không thì Hub không mount `/studio` (404 JSON từ `notFound` gốc). */
export function mountStudioStatic<E extends Env>(app: Hono<E>, dist: string): void {
  const index = join(dist, "index.html");
  const files = serveStatic({
    root: dist,
    rewriteRequestPath: (p) => p.slice(BASE.length) || "/",
    onFound: (_path, c) => {
      c.header("Cache-Control", c.req.path.startsWith(`${BASE}/static/`) ? IMMUTABLE : "no-cache");
    },
  });
  app.get(BASE, (c) => {
    secure(c);
    return c.redirect(`${BASE}/`, 308);
  });
  app.get(`${BASE}/*`, async (c, next) => {
    if (isStudioApiPath(c.req.path)) return next();
    secure(c);
    if (isTraversal(new URL(c.req.url).pathname))
      return c.json(toErrorBody("NOT_FOUND", "Not found"), 404);
    const served = await files(c, async () => {});
    if (served) return served;
    if (hasExtension(c.req.path)) return c.json(toErrorBody("NOT_FOUND", "Not found"), 404);
    c.header("Cache-Control", "no-cache");
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(Bun.file(index).stream());
  });
}
