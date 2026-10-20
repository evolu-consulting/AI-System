// Kiểm sohoptac2 qua SSH tunnel (README): đăng nhập admin-web, contracts-web, chat-web (một lượt chat thật), ảnh vào docs/deploy/sohoptac2.
// Chạy bằng Node thật: S2_PW=<từ ADMIN_CREDENTIALS.txt, không in> node deploy/prod-sohoptac2/verify-ui.mjs [all|admin|contracts|chat]
import { createRequire } from "node:module";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const OUT = new URL("../../docs/deploy/sohoptac2", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const PW = process.env.S2_PW;
if (!PW) throw new Error("S2_PW missing");
const only = process.argv[2] ?? "all";
const res = {};

async function fillLogin(page) {
  const t = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  await page
    .getByLabel(/^(Mật khẩu|Password)$/)
    .first()
    .waitFor({ timeout: 30000 });
  if (await t.count()) await t.fill("platform");
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill("admin");
  await page
    .getByLabel(/^(Mật khẩu|Password)$/)
    .first()
    .fill(PW);
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
try {
  for (const [name, port] of [
    ["admin", 18432],
    ["contracts", 18431],
  ]) {
    if (only !== "all" && only !== name) continue;
    const page = await ctx.newPage();
    const seen = [];
    page.on("response", (r) => {
      if (!/\.(js|css|svg|png|woff2?)$/.test(r.url()))
        seen.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
    });
    await page.goto(`http://localhost:${port}/`);
    await page
      .getByLabel(/^(Mật khẩu|Password)$/)
      .first()
      .waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${OUT}/${name}-01-login.png` });
    await fillLogin(page);
    await page.waitForTimeout(6000);
    res[`${name}_requests`] = seen.slice(0, 20);
    res[`${name}_url`] = page.url();
    res[`${name}_still_on_login`] = await page
      .getByRole("button", { name: /^(Đăng nhập|Sign in)$/ })
      .isVisible()
      .catch(() => false);
    await page.screenshot({ path: `${OUT}/${name}-02-after-login.png` });
    await page.close();
  }
  if (only === "all" || only === "chat") {
    const page = await ctx.newPage();
    await page.goto("http://localhost:18433/login");
    await fillLogin(page);
    await page.waitForURL(/\/c\//, { timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/chat-00-home.png` });
    res.chat_home = (await page.locator("body").innerText()).slice(0, 400);
    const box = page.getByRole("textbox", { name: /^(Tin nhắn|Message)$/ });
    await box.fill(
      "Xin chào! Đây là kiểm tra triển khai — hãy trả lời ngắn một câu bằng tiếng Việt.",
    );
    const sent = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
      { timeout: 30000 },
    );
    await box.press("Enter");
    const sr = await sent;
    res.chat_send_status = sr.status();
    await page.screenshot({ path: `${OUT}/chat-01-sent.png` });
    const log = page.getByRole("log", { name: /Nội dung hội thoại|Conversation/ });
    const t0 = Date.now();
    await page.waitForTimeout(2000);
    await page
      .getByRole("button", { name: /^(Dừng|Stop)/ })
      .waitFor({ state: "detached", timeout: 240000 })
      .catch(() => {});
    res.chat_wait_ms = Date.now() - t0;
    await page.waitForTimeout(1500);
    res.chat_log_text = (await log.innerText().catch(() => "")).slice(0, 600);
    res.chat_url = page.url();
    await page.screenshot({ path: `${OUT}/chat-02-reply.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(res, null, 1));
