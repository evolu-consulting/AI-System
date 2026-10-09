// Tiện ích chung UAT CR-054. Mật khẩu platform_admin đọc từ .env.local lúc chạy, KHÔNG ghi ra log/ảnh.
import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export { chromium, expect };
export const ADMIN = "http://localhost:3000";
export const CHAT = "http://localhost:3100";
export const STUDIO = "http://localhost:3200/studio";
export const PW = "1234567890";

export function platformCreds() {
  const env = {};
  for (const line of readFileSync("D:/AI/ai-system/.env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(SEED_ADMIN_USERNAME|SEED_ADMIN_PASSWORD)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { user: env.SEED_ADMIN_USERNAME, pass: env.SEED_ADMIN_PASSWORD };
}

export function makeRunner(OUT, name) {
  mkdirSync(OUT, { recursive: true });
  const log = [];
  const pages = [];
  const snap = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  async function step(id, title, fn) {
    const t0 = Date.now();
    try {
      await fn();
      log.push({ id, title, ok: true, ms: Date.now() - t0 });
      console.log("PASS", id, title);
    } catch (e) {
      const err = String(e.message).split("\n")[0].slice(0, 400);
      log.push({ id, title, ok: false, err });
      console.log("FAIL", id, title, err);
      for (const [i, p] of pages.entries()) await snap(p, `${id}-FAIL-${i}`).catch(() => {});
    }
  }
  const finish = () => writeFileSync(`${OUT}/result-${name}.json`, JSON.stringify(log, null, 2));
  return { log, pages, snap, step, finish };
}

/** Đăng nhập form chung (admin-web / studio-web / chat-web). */
export async function login(p, base, tenant, user, pass, urlRe) {
  await p.goto(`${base}/login`);
  const vi = p.getByRole("button", { name: "Tiếng Việt", exact: true });
  await vi.waitFor({ timeout: 15000 }).catch(() => {}); if (await vi.isVisible().catch(() => false)) await vi.click();
  await p.getByLabel("Mã công ty").fill(tenant);
  await p.getByLabel("Tên đăng nhập").fill(user);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(pass);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(urlRe, { timeout: 30000 });
}

/** Sau đăng nhập admin-web có thể về EN: bấm VI nếu có. */
export async function ensureVi(p) {
  await p.evaluate(() => localStorage.setItem("ai.locale", "vi"));
  await p.reload();
}
