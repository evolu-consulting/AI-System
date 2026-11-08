// CR-118 · UAT smoke trên stack sohoptac2-cr118 (web gộp). Chạy từ máy dev qua SSH tunnel: `playwright test -c e2e/stg/uat-cr118.config.ts`.
// Env: UAT_WEB (vd http://127.0.0.1:28531), UAT_OWNER_PW, UAT_ADMIN_PW, UAT_PARTNERS_FILE (out/partners.json). Mật khẩu không in.
// Ca: chủ quản/quản trị công ty · thành viên · đối tác: Community ↔ SHT không tải lại, tắt Community ẩn nav (SSE), đối tác gõ /contracts bị chặn,
// Cài đặt › Quy trình duyệt, bài Community kèm PDF (tải lên + tải về).
import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`uat-cr118: thiếu ${n}`);
  return v;
};
const WEB = need("UAT_WEB");
const OWNER_PW = need("UAT_OWNER_PW");
const NEW_PW = "Uat-Cr118-Pass-2026!";
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const partnerPw = (u: string): string =>
  (JSON.parse(readFileSync(need("UAT_PARTNERS_FILE"), "utf8")) as { users: Record<string, string> })
    .users[u] ?? "";

async function login(page: Page, user: string, pws: string[]): Promise<void> {
  await page.goto("/login?next=%2Fcommunity");
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill("demo");
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(user);
  const submit = page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ });
  const change = page.getByRole("heading", { name: "Đặt mật khẩu mới" });
  for (const p of pws) {
    await pw.fill(p);
    await submit.click();
    const ok = page.getByTestId("composer");
    await expect(change.or(ok).or(page.getByRole("alert"))).toBeVisible({ timeout: 45_000 });
    if (await change.isVisible()) {
      const f = page.locator("input[type=password]");
      for (let i = 0; i < (await f.count()); i++) await f.nth(i).fill(NEW_PW);
      await page.locator("button[type=submit]").first().click();
      await expect(ok).toBeVisible({ timeout: 45_000 });
      return;
    }
    if (await ok.first().isVisible()) return;
  }
  throw new Error(`đăng nhập ${user} thất bại`);
}

async function token(req: APIRequestContext, tenant: string, user: string, pw: string) {
  const r = await req.post(`${WEB}/auth/login`, {
    data: { tenant_key: tenant, username: user, password: pw },
  });
  expect(r.status(), `login API ${user}`).toBe(200);
  return { authorization: `Bearer ${((await r.json()) as { access_token: string }).access_token}` };
}

test.describe.configure({ mode: "serial" });
test.use({ baseURL: WEB, locale: "vi-VN" });

let memberPw = "";
const MEMBER = "uat-member";
let communityPack = { key: "community", level: "" };
let tid = "";

test("setup: tạo thành viên SHT thường (nhóm contracts-viewer + community-editor)", async ({
  request,
}) => {
  const h = await token(request, "platform", "admin", need("UAT_ADMIN_PW"));
  const ts = (await (await request.get(`${WEB}/admin/tenants`, { headers: h })).json()) as {
    items: { id: string; key: string }[];
  };
  tid = ts.items.find((x) => x.key === "demo")?.id as string;
  expect(tid).toBeTruthy();
  const c = await request.post(`${WEB}/admin/users?tenant_id=${tid}`, {
    headers: h,
    data: { username: MEMBER, display_name: "UAT Thành viên", role: "member", locale: "vi" },
  });
  expect([201, 409]).toContain(c.status());
  if (c.status() === 201) memberPw = ((await c.json()) as { temp_password: string }).temp_password;
  else {
    const us = (await (
      await request.get(`${WEB}/admin/users?tenant_id=${tid}&limit=200`, { headers: h })
    ).json()) as {
      items: { id: string; username: string }[];
    };
    const id = us.items.find((x) => x.username === MEMBER)?.id;
    const r = await request.post(`${WEB}/admin/users/${id}/reset-password`, { headers: h });
    expect(r.status(), "đặt lại mật khẩu thành viên").toBe(200);
    memberPw = ((await r.json()) as { temp_password: string }).temp_password;
  }
  const gs = (await (
    await request.get(`${WEB}/admin/groups?tenant_id=${tid}`, { headers: h })
  ).json()) as {
    items: { id: string; key: string }[];
  };
  for (const k of ["contracts-viewer", "community-editor"]) {
    const g = gs.items.find((x) => x.key === k);
    if (!g) continue;
    const r = await request.post(`${WEB}/admin/groups/${g.id}/members`, {
      headers: h,
      data: { usernames: [MEMBER] },
    });
    expect(r.status(), `thêm ${MEMBER} vào ${k}`).toBeLessThan(300);
  }
});

test("chủ quản/quản trị: Community ↔ SHT không tải lại trang; Cài đặt › Quy trình duyệt", async ({
  page,
}) => {
  await login(page, "demo-owner", [OWNER_PW]);
  await page.evaluate(() => ((window as unknown as { __mark: string }).__mark = "m1"));
  await page.getByTestId("sht-link").first().click();
  await expect(page).toHaveURL(/\/contracts$/, { timeout: 30_000 });
  await expect(page.getByTestId("nav-community")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-community").click();
  await expect(page).toHaveURL(/\/community/);
  await expect(page.getByTestId("composer")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __mark?: string }).__mark)).toBe("m1");
  await page.goto("/contracts/settings?sec=flow");
  await expect(
    page.getByTestId("flow-current-title").or(page.getByTestId("flow-none")),
  ).toBeVisible({
    timeout: 30_000,
  });
});

test("Community: đăng bài kèm PDF, thẻ tệp + tải về (thật)", async ({ page }) => {
  await login(page, "demo-owner", [OWNER_PW]);
  const c = page.getByTestId("composer");
  await c.getByRole("button", { name: "Cần bán", exact: true }).click();
  await page.getByTestId("attach-input").setInputFiles({
    name: "bao-gia-uat.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await expect(c.locator(".attach", { hasText: "bao-gia-uat.pdf" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Keo UAT kèm PDF");
  await page.getByLabel("Số lượng").fill("3 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const posted = page.getByTestId("post").filter({ hasText: "Keo UAT kèm PDF" }).first();
  const card = posted.getByTestId("file-card");
  await expect(card).toContainText("bao-gia-uat.pdf", { timeout: 30_000 });
  await expect(card).toContainText("Tải về");
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    card.click(),
  ]);
  expect(dl.suggestedFilename()).toBe("bao-gia-uat.pdf");
  const p = await dl.path();
  expect(readFileSync(p).length, "kích thước tệp tải về").toBe(PDF.length);
});

test("tắt Community (platform admin) ⇒ nav Community biến mất không tải lại; bật lại", async ({
  page,
  request,
}) => {
  const adminPw = need("UAT_ADMIN_PW");
  const a = await token(request, "platform", "admin", adminPw);
  const list = (await (
    await request.get(`${WEB}/admin/tenants/${tid}/packs`, { headers: a })
  ).json()) as {
    items: {
      key?: string;
      pack_key?: string;
      level?: string;
      action?: string;
      enabled?: boolean;
    }[];
  };
  const p = list.items.find((x) => /community/.test(x.key ?? x.pack_key ?? ""));
  expect(p, "gói community của tenant").toBeTruthy();
  communityPack = { key: (p?.key ?? p?.pack_key) as string, level: p?.level ?? p?.action ?? "" };
  await login(page, "demo-owner", [OWNER_PW]);
  await page.getByTestId("sht-link").first().click();
  await expect(page.getByTestId("nav-community")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => ((window as unknown as { __m2: string }).__m2 = "x"));
  const off = await request.delete(`${WEB}/admin/tenants/${tid}/packs/${communityPack.key}`, {
    headers: a,
  });
  expect(off.status(), "tắt gói").toBeLessThan(300);
  try {
    await expect(page.getByTestId("nav-community")).toHaveCount(0, { timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __m2?: string }).__m2)).toBe("x");
  } finally {
    const q = communityPack.level ? `?level=${communityPack.level}` : "";
    const on = await request.put(`${WEB}/admin/tenants/${tid}/packs/${communityPack.key}${q}`, {
      headers: a,
    });
    expect(on.status(), "bật lại gói").toBeLessThan(300);
  }
});

test("thành viên SHT: Community ↔ SHT không tải lại", async ({ page }) => {
  await login(page, MEMBER, [memberPw, NEW_PW]);
  await page.evaluate(() => ((window as unknown as { __mark: string }).__mark = "m3"));
  await page.getByTestId("sht-link").first().click();
  await expect(page).toHaveURL(/\/contracts$/, { timeout: 30_000 });
  await page.getByTestId("nav-community").click();
  await expect(page).toHaveURL(/\/community/);
  expect(await page.evaluate(() => (window as unknown as { __mark?: string }).__mark)).toBe("m3");
});

test("đối tác: vào /community, gõ /contracts bị chặn (không có SHT)", async ({ page }) => {
  const u = "doitac-tanphat";
  await login(page, u, [partnerPw(u), NEW_PW]);
  await expect(page.getByTestId("sht-link")).toHaveCount(0);
  await page.goto("/contracts/list");
  await expect(page).toHaveURL(/\/community/, { timeout: 30_000 });
  await page.goto("/contracts");
  await expect(page).toHaveURL(/\/community/, { timeout: 30_000 });
});
