// UAT K1 phần E: ảnh so mockup — Cài đặt/Sheet/Dialog kiểm/Agent; VI + EN, desktop + mobile hẹp. Dùng: node k1-shots.mjs <outDir> <vi|en> <desktop|mobile>
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
const OUT = process.argv[2], LANG = process.argv[3] ?? "vi", VP = process.argv[4] ?? "desktop";
const viewport = VP === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const T = LANG === "vi"
  ? { settings: "Cài đặt", add: "Thêm kết nối", test: "Kiểm tra", result: "Kết quả kiểm tra", agentRegion: "KnowledgeHub", cancel: "Huỷ", login: "Đăng nhập" }
  : { settings: "Settings", add: "Add connection", test: "Test", result: "Check result", agentRegion: "KnowledgeHub", cancel: "Cancel", login: "Sign in" };
const { browser, page } = await launch(OUT, viewport, LANG);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const P = `${VP}-${LANG}`;
const put = (cfg) => fetch("http://localhost:4030/__mock/kh", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
async function login() {
  await page.goto("http://localhost:3200/studio/login");
  await page.getByRole("textbox", { name: LANG === "vi" ? "Mã công ty" : "Company code" }).fill("platform");
  await page.getByRole("textbox", { name: LANG === "vi" ? "Tên đăng nhập" : "Username" }).fill("admin");
  await page.getByLabel(LANG === "vi" ? "Mật khẩu" : "Password").first().fill("1234567890");
  await page.getByRole("button", { name: T.login, exact: true }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"));
}
await login();
const pickLang = async (name) => {
  await page.goto("http://localhost:3200/studio/settings"); await page.waitForTimeout(2500);
  await page.getByText("Platform Admin").click();
  await page.getByText(name, { exact: true }).last().click();
  await page.waitForTimeout(1200);
};
if (LANG === "en") await pickLang("English");
await step(`${P}-S1`, "Cài đặt: bảng kết nối", async () => {
  await page.goto("http://localhost:3200/studio/settings");
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15000 });
  await snap(page, `${P}-01-settings`, true);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(P, "overflow-x px:", ov);
});
await step(`${P}-S2`, "Sheet Thêm kết nối (hết tải, không animation)", async () => {
  await page.getByRole("button", { name: T.add }).first().click();
  await page.waitForTimeout(700);
  await snap(page, `${P}-02-sheet`);
  await page.keyboard.press("Escape");
});
await step(`${P}-S3`, "Dialog kết quả kiểm: Đạt", async () => {
  await page.getByRole("button", { name: new RegExp(`^${T.test} kh-main`) }).click();
  await expect(page.getByRole("dialog", { name: T.result })).toBeVisible();
  await page.waitForTimeout(900);
  await snap(page, `${P}-03-check-ok`);
  await page.keyboard.press("Escape");
});
await step(`${P}-S4`, "Dialog kết quả kiểm: Đạt kèm cảnh báo (embedder tiếng Anh, project rỗng)", async () => {
  await put({ scenario: "ok", model: "BAAI/bge-small-en-v1.5" });
  await page.getByRole("button", { name: new RegExp(`^${T.test} kh-main`) }).click();
  await expect(page.getByRole("dialog", { name: T.result })).toBeVisible();
  await page.waitForTimeout(1200);
  await snap(page, `${P}-04-check-warning`);
  await page.keyboard.press("Escape");
  await put({ scenario: "ok", model: "BAAI/bge-m3" });
});
await step(`${P}-S5`, "Agent: section KnowledgeHub", async () => {
  await page.goto("http://localhost:3200/studio/agents/c5cfdb36-6e4b-4d87-b612-542b132fbea5");
  const r = page.getByRole("region", { name: T.agentRegion });
  await expect(r).toBeVisible({ timeout: 15000 });
  await r.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await snap(page, `${P}-05-agent`);
  await snap(page, `${P}-05b-agent-full`, true);
});
if (LANG === "en") await pickLang("Tiếng Việt");
save(); await browser.close();
