// sohoptac2-stg · smoke trên image PROD (xem stg.config.ts). Cách ly: mọi request ra ngoài dải 127.0.0.1:284xx bị CHẶN và ghi vào LEAKS
// (image web nung PUBLIC_* của prod ⇒ nếu có luồng nhảy sang tên miền prod thì lộ ra ở đây, test cuối thất bại). Không đăng nhập prod.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { loginAs } from "../community-web/_stack";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`smoke.stg: thiếu ${n}`);
  return v;
};
const H = need("STG_WEB_BASE");
const P = {
  cw: need("STG_PORT_CONTRACTS"),
  admin: need("STG_PORT_ADMIN"),
  chat: need("STG_PORT_CHAT"),
  community: need("STG_PORT_COMMUNITY"),
};
const URLS = {
  cw: `http://${H}:${P.cw}`,
  admin: `http://${H}:${P.admin}`,
  chat: `http://${H}:${P.chat}`,
  community: `http://${H}:${P.community}`,
};
const ALLOWED = new Set(Object.values(P));
const OUT = "/w/out";
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const ADMIN_PW = readFileSync(need("STG_ADMIN_PW_FILE"), "utf8").trim();
const OWNER_PW = readFileSync(need("STG_OWNER_PW_FILE"), "utf8").trim();
const LEAKS: string[] = [];
const SERVER_ERRS: string[] = [];

async function newPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    baseURL: URLS.community,
    locale: "vi-VN",
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
  await ctx.route(
    (u) => !(u.hostname === H && ALLOWED.has(u.port)) && u.protocol.startsWith("http"),
    (r) => {
      LEAKS.push(`${r.request().method()} ${r.request().url()}`);
      return r.abort("blockedbyclient");
    },
  );
  const page = await ctx.newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) SERVER_ERRS.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { ctx, page };
}

async function login(page: Page, base: string, tenant: string, user: string, pw: string) {
  await page.goto(`${base}/login`);
  const pwd = page.locator("input[type=password]").first();
  await pwd.waitFor({ timeout: 45_000 });
  const t = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await t.count()) await t.fill(tenant);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(user);
  await pwd.fill(pw);
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 });
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

test.describe.configure({ mode: "serial" });

test.describe("stg · community-web", () => {
  test("trang Đăng nhập dùng font Be Vietnam Pro (không rơi về serif)", async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${URLS.community}/`);
    await page.locator("input[type=password]").first().waitFor({ timeout: 45_000 });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(async () => {
      const fam = (s: string) => {
        const e = document.querySelector(s);
        return e ? getComputedStyle(e).fontFamily : null;
      };
      const faces = [...document.fonts].filter((f) => /Be Vietnam Pro/i.test(f.family));
      await Promise.all(faces.map((f) => f.load().catch(() => null)));
      return {
        body: fam("body"),
        input: fam("input[type=password]"),
        button: fam("button"),
        heading: fam("h1, h2"),
        loaded: [...document.fonts].filter(
          (f) => /Be Vietnam Pro/i.test(f.family) && f.status === "loaded",
        ).length,
        check: document.fonts.check('16px "Be Vietnam Pro"'),
      };
    });
    await shot(page, "01-community-login-font");
    writeFileSync(`${OUT}/font.json`, JSON.stringify(r, null, 2));
    for (const k of ["body", "input", "button"] as const)
      expect(r[k], `font-family của ${k}`).toMatch(/Be Vietnam Pro/i);
    expect(r.loaded, "số FontFace Be Vietnam Pro đã nạp").toBeGreaterThan(0);
    await ctx.close();
  });

  test("chủ quản thấy nhóm Sổ Hợp Tác; đối tác KHÔNG có trong DOM (cách ly vai)", async ({
    browser,
  }) => {
    const host = await newPage(browser);
    await loginAs(host.page, "host");
    await shot(host.page, "02-community-host-feed");
    const hostLink = host.page.getByTestId("sht-link");
    expect(await hostLink.count(), "chủ quản có link Sổ Hợp Tác (caps.contracts)").toBeGreaterThan(
      0,
    );
    await host.ctx.close();
    const partner = await newPage(browser);
    await loginAs(partner.page, "supplier");
    await shot(partner.page, "03-community-partner-feed");
    await expect(partner.page.getByTestId("sht-link")).toHaveCount(0);
    // Tên tenant demo là "Demo Sổ Hợp Tác" (brand công ty chủ quản) ⇒ bỏ cụm đó rồi mới kiểm không còn tên app Sổ Hợp Tác.
    const html = (await partner.page.content()).replaceAll("Demo Sổ Hợp Tác", "");
    expect(html.includes("Sổ Hợp Tác"), "DOM đối tác còn nhắc Sổ Hợp Tác").toBe(false);
    expect(
      html.includes("/overview") || html.includes("sht-link"),
      "DOM đối tác còn link Sổ Hợp Tác",
    ).toBe(false);
    await partner.ctx.close();
  });
});

test.describe("stg · contracts-web", () => {
  test("Cài đặt: /settings?sec=flow mở hộp thoại ở mục Quy trình + canvas", async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    await login(page, URLS.cw, "demo", "demo-owner", OWNER_PW);
    await shot(page, "04-contracts-after-login");
    await page.goto(`${URLS.cw}/contracts/settings?sec=flow`);
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await shot(page, "05-contracts-settings-flow");
    const canvas = dlg.getByTestId("flow-canvas");
    await expect(canvas, "canvas quy trình trong Cài đặt").toBeVisible({ timeout: 30_000 });
    await shot(page, "06-contracts-settings-canvas");
    await ctx.close();
  });
});

test.describe("stg · admin-web", () => {
  test("danh mục Features (nhóm theo app) + tab Feature của tenant demo", async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    await login(page, URLS.admin, "platform", "admin", ADMIN_PW);
    await page.goto(`${URLS.admin}/features`);
    await expect(page.getByRole("table", { name: /^Features/ }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { level: 2, name: /Sổ Hợp Tác|Contract Ledger/ }),
    ).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "contracts-read" })).toContainText(
      /Xem hợp đồng|View contracts|Read contracts/i,
    );
    await shot(page, "07-admin-features");
    await page.goto(`${URLS.admin}/tenants`);
    await page.getByRole("link", { name: "demo", exact: true }).first().click();
    await page.waitForURL(/\/tenants\/[0-9a-f-]{36}/);
    const id = new URL(page.url()).pathname.split("/")[2];
    await page.goto(`${URLS.admin}/tenants/${id}?tab=features`);
    const card = page.getByRole("region", { name: /Sổ Hợp Tác|Contract Ledger/ });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(/Đang:|Current:|Now:/);
    await shot(page, "08-admin-tenant-features");
    await ctx.close();
  });

  test("SSO: admin-web (chủ công ty) → app switcher → Sổ Hợp Tác, không đăng nhập lại", async ({
    browser,
  }) => {
    const { ctx, page } = await newPage(browser);
    await login(page, URLS.admin, "demo", "demo-owner", OWNER_PW);
    await shot(page, "09-admin-owner-home");
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    await shot(page, "10-admin-switcher");
    await page.getByRole("menuitem", { name: /Sổ Hợp Tác/ }).click();
    await page.waitForURL((u) => u.href.startsWith(URLS.cw) && !u.pathname.startsWith("/login"), {
      timeout: 45_000,
    });
    await expect(page.getByRole("link", { name: "Tổng quan" }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await shot(page, "11-sso-landed-contracts");
    await ctx.close();
  });
});

test("cách ly: không request nào rời dải 127.0.0.1:284xx; không HTTP 5xx", async () => {
  // PUBLIC_* của web được NUNG lúc build image prod (https://*.evoluconsulting.com) ⇒ vài lời gọi tuyệt đối (vd admin-web → PUBLIC_HUB_URL)
  // trỏ ra tên miền prod. Smoke CHẶN chúng (không bao giờ chạm prod) và ghi lại; chỉ coi là lỗi khi trỏ tới host khác.
  const baked = LEAKS.filter((l) => /\.evoluconsulting\.com\b/.test(l));
  const other = LEAKS.filter((l) => !baked.includes(l));
  writeFileSync(
    `${OUT}/leaks.json`,
    JSON.stringify(
      {
        baked_prod_urls_blocked: [...new Set(baked)],
        other_leaks: other,
        server_errors: SERVER_ERRS,
      },
      null,
      2,
    ),
  );
  test.info().annotations.push({
    type: "baked-prod-urls-blocked",
    description: [...new Set(baked)].join(" | "),
  });
  expect.soft(SERVER_ERRS, "HTTP 5xx").toEqual([]);
  expect(other, "request ra ngoài stg tới host lạ").toEqual([]);
});
