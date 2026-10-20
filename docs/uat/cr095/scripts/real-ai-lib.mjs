import { chromium } from "file:///F:/workspace/evolu-platform/node_modules/@playwright/test/index.mjs";
import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
export const OUT = "F:/workspace/evolu-wt/demo-tenant/docs/uat/cr095";
export const CW = "http://localhost:18431";
export function cred(u) { const t = readFileSync(process.env.DEMO_CRED, "utf8"); const m = t.split("\n").find((l) => l.startsWith(u + " / ")); return m.split(" / ")[1].split(" ")[0].trim(); }
export async function snap(p, n) { mkdirSync(OUT + "/shots", { recursive: true }); await p.screenshot({ path: `${OUT}/shots/real-ai-${n}.png` }); return `shots/real-ai-${n}.png`; }
export async function login(p, u) {
  await p.goto(CW + "/login");
  await p.getByRole("textbox", { name: "Email" }).waitFor({ timeout: 30000 });
  const tenant = p.getByRole("textbox", { name: "Mã công ty" });
  if (await tenant.count()) await tenant.fill("demo");
  await p.getByRole("textbox", { name: "Email" }).fill(u);
  await p.locator("input[name=password]").fill(cred(u));
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL((x) => !x.pathname.startsWith("/login"), { timeout: 30000 });
}
export async function ctx(b) {
  const c = await b.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Ho_Chi_Minh" });
  await c.addInitScript(() => { try { localStorage.setItem("ai.locale", "vi"); } catch {} });
  return c;
}
export const log = (o) => { appendFileSync(OUT + "/real-ai-results.jsonl", JSON.stringify(o) + "\n"); console.log(JSON.stringify(o)); };
export { chromium };