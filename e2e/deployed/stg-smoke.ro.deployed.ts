// CR-126 · smoke e2e STAGING CHỈ ĐỌC (hosts *-test.evoluconsulting.com). Mỗi tài khoản đăng nhập ĐÚNG MỘT lần (giới hạn 30 lượt/10 phút/IP),
// mở các màn chính, kiểm: HTTP OK, không toast/banner lỗi, không khoá i18n thô, không XHR 404/5xx. Không bấm Duyệt/Gửi/Ký/Lưu/Xoá, không submit.
// Tài khoản: env STG_ACCOUNTS (JSON [{role,login,password,tenant}]) do deploy/stg-test/e2e-smoke.ps1 nạp từ .data/staging-for-pm.md (không in mật khẩu).
import type { Page } from "@playwright/test";
import { ADMIN, CW, expect, settle, test } from "./_support";

type Acc = { role: string; login: string; password: string; tenant: string };
const ACCS: Acc[] = (() => {
  try {
    return JSON.parse(process.env.STG_ACCOUNTS ?? "[]") as Acc[];
  } catch {
    return [];
  }
})();

const KEY_RE = /\b(contracts|common|admin)\.[a-z][\w.]+/;
const CW_SCREENS: [string, string][] = [
  ["Tổng quan", "/contracts"],
  ["Hợp đồng & giao dịch", "/contracts/list"],
  ["Yêu cầu", "/contracts/requests"],
  ["Việc của tôi", "/contracts/approvals"],
  ["Hộp thư đối tác", "/contracts/partner-inbox"],
];
const ADMIN_SCREENS: [string, string][] = [
  ["Admin home", "/"],
  ["Quy trình", "/processes"],
];

async function loginTo(page: Page, base: string, a: Acc): Promise<void> {
  await page.goto(`${base}/login`);
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(a.tenant);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)/ }).fill(a.login);
  await pw.fill(a.password);
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  const left = await page
    .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 })
    .then(() => false)
    .catch(() => true);
  if (left) {
    // Tài khoản đối tác lần đầu: màn «đổi mật khẩu tạm» — chỉ đọc nên không đổi; ghi nhận SKIP, không đỏ.
    if (await page.getByText(/đổi mật khẩu tạm|Lần đăng nhập đầu tiên/).count())
      test.skip(true, `${a.login}: bắt đổi mật khẩu lần đầu (không đổi trong smoke chỉ đọc)`);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  }
}

function watchApi(page: Page, bad: string[]): void {
  page.on("response", (r) => {
    const t = r.request().resourceType();
    if (t !== "xhr" && t !== "fetch") return;
    const u = new URL(r.url());
    if ((r.status() === 404 || r.status() >= 500) && !/favicon/.test(u.pathname))
      bad.push(`HTTP ${r.status()} ${r.request().method()} ${u.host}${u.pathname}`);
  });
}

async function checkScreen(
  page: Page,
  base: string,
  name: string,
  path: string,
  problems: string[],
): Promise<boolean> {
  const resp = await page.goto(`${base}${path}`);
  if (!resp || resp.status() >= 400) {
    problems.push(`${name}: HTTP ${resp?.status()} ${path}`);
    return false;
  }
  await settle(page);
  if (new URL(page.url()).pathname.startsWith("/login")) {
    problems.push(`${name}: bị đẩy về /login`);
    return false;
  }
  const text = await page.locator("body").innerText();
  const k = KEY_RE.exec(text);
  if (k) problems.push(`${name}: khoá i18n thô «${k[0]}»`);
  const alerts = await page
    .locator('[data-sonner-toast][data-type="error"], [role="alert"]')
    .allInnerTexts();
  for (const t of alerts)
    if (/lỗi|error|failed|thất bại/i.test(t))
      problems.push(`${name}: banner lỗi «${t.slice(0, 80)}»`);
  return true;
}

/** Chỉ ĐỌC: mở việc «Chọn đối tác & người nhận» (nếu có) và đếm lựa chọn của ô đối tác; không gửi gì. */
async function checkPartnerPick(page: Page, problems: string[]): Promise<string> {
  await page.goto(`${CW}/contracts/approvals`);
  await settle(page);
  const row = page.getByText(/Chọn đối tác & người nhận/).first();
  if (!(await row.count())) return "no-task";
  await row.click();
  await settle(page);
  const sel = page.locator("select").first();
  let n = 0;
  if (await sel.count()) n = await sel.locator("option:not([value=''])").count();
  else {
    const cb = page.getByRole("combobox").first();
    if (await cb.count()) {
      await cb.click();
      n = await page.getByRole("option").count();
      await page.keyboard.press("Escape");
    }
  }
  if (n < 1) problems.push("Chọn đối tác & người nhận: ô đối tác không có lựa chọn nào");
  return `options=${n}`;
}

async function visitScreens(page: Page, a: Acc, problems: string[]): Promise<void> {
  const isPlatform = a.tenant === "platform";
  const base = isPlatform ? ADMIN : CW;
  for (const [name, path] of isPlatform ? ADMIN_SCREENS : CW_SCREENS) {
    const hidden =
      name === "Hộp thư đối tác" &&
      !(await page.locator('a[href$="/contracts/partner-inbox"]').count());
    if (!hidden) await checkScreen(page, base, name, path, problems);
  }
  if (!isPlatform && /owner|editor|viewer/.test(a.role)) {
    console.log(`[stg-smoke] ${a.login} partner-pick: ${await checkPartnerPick(page, problems)}`);
  }
}

test.describe("CR-126 smoke staging (chỉ đọc)", () => {
  test.skip(ACCS.length === 0, "STG_ACCOUNTS trống — chạy qua deploy/stg-test/e2e-smoke.ps1");
  for (const a of ACCS) {
    test(`${a.role} ${a.login}`, async ({ page }) => {
      const problems: string[] = [];
      const api: string[] = [];
      watchApi(page, api);
      await loginTo(page, a.tenant === "platform" ? ADMIN : CW, a);
      await settle(page);
      await visitScreens(page, a, problems);
      problems.push(...new Set(api));
      expect(problems, `${a.login}: ${problems.join(" | ")}`).toEqual([]);
    });
  }
});
