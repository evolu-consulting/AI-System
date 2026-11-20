// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-191 · BR-191-12 · hành trình «bình luận chéo công ty đã kết nối» (G4, N2: mỗi bước đúng vai, người bình luận/ẩn KHÁC người mời kết nối).
// Stack + hai công ty như `tin-nhan-cong-ty.spec.ts` (playwright.cr169.config.ts). NitiGroup (A): Vy đăng bài, Tiên (Toàn quyền) ẩn + ngắt kết nối.
// Preschool (B): Hà bình luận. Bài dựng qua API (ô soạn đã có e2e riêng).
import { type Browser, expect, test } from "@playwright/test";
import { apiLogin, type Session, tenantIdByKey } from "../_kit/api";
import { CO, WHO } from "../_kit/two-companies";
import { type Env, loginCw } from "../journey-approval/_journey";

test.describe.configure({ mode: "serial" });
const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.cr169.config.ts)`);
  return v;
};
const envOf = (side: "a" | "b"): Env => ({
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: CO[side].key(),
  tenantName: CO[side].name,
});
const [EA, EB] = [envOf("a"), envOf("b")];
const HUB = need("JA_HUB_URL");
const RUN = need("CR169_RUN");
const TITLE = `Cần bán thùng carton ${RUN}`;
const NOTE = `Preschool quan tâm lô này ${RUN}`;
const apiOf = (e: Env, user: string): Promise<Session> =>
  apiLogin({
    base: need("JA_API_URL"),
    tenantKey: e.tenantKey,
    username: user,
    password: e.pw,
    app: "contracts",
  });
const open = async (browser: Browser, e: Env, user: string) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, e, user);
  await page.goto("/community");
  return { ctx, page };
};
/** Mở bình luận (bài có bình luận đã mở sẵn 3 bình luận mới nhất — bấm lại sẽ ĐÓNG). */
const openThread = async (c: import("@playwright/test").Locator) => {
  const b = c.locator(".pact button");
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
};
const card = (page: import("@playwright/test").Page) =>
  page.getByTestId("post").filter({ hasText: TITLE }).first();

test.beforeAll(async () => {
  const p = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const tenantA = await tenantIdByKey(need("JA_API_URL"), p, EA.tenantKey);
  const tenantB = await tenantIdByKey(need("JA_API_URL"), p, EB.tenantKey);
  const [tien, dung, vy] = [
    await apiOf(EA, WHO.tien),
    await apiOf(EB, WHO.dung),
    await apiOf(EA, WHO.vy),
  ];
  // kết nối (có thể đã có từ ca khác cùng stack ⇒ chấp nhận 409)
  const inv = await fetch(`${HUB}/pack/contracts/connect/invites`, {
    method: "POST",
    headers: { ...tien.headers, "content-type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantB }),
  });
  expect([200, 409]).toContain(inv.status);
  const acc = await fetch(`${HUB}/pack/contracts/connect/links/${tenantA}/accept`, {
    method: "POST",
    headers: dung.headers,
  });
  expect([200, 409]).toContain(acc.status);
  const post = await fetch(`${HUB}/pack/community/posts`, {
    method: "POST",
    headers: { ...vy.headers, "content-type": "application/json" },
    body: JSON.stringify({
      type: "note",
      title: TITLE,
      body: "Còn 2.000 thùng, giao trong tuần",
      audience: { mode: "all", cats: [], companies: [], tenants: [] },
    }),
  });
  expect(post.status).toBe(201);
});

test("CR191-C1 · Hà (Preschool, không phải người đăng) mở bài «Đối tác» của NitiGroup ⇒ có ô bình luận, gửi ⇒ hiện tên + công ty mình", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EB, WHO.ha);
  const c = card(page);
  await expect(c.getByTestId("post-source")).toHaveAttribute("data-source", "connected");
  await openThread(c);
  await c.getByRole("combobox", { name: /bình luận/i }).fill(NOTE);
  await c.getByRole("combobox", { name: /bình luận/i }).press("Enter");
  const mine = c.getByTestId("comment").filter({ hasText: NOTE });
  await expect(mine).toBeVisible();
  await expect(mine).toContainText(CO.b.name);
  await ctx.close();
});

test("CR191-C2 · Tiên (quản trị NitiGroup, không phải người đăng) thấy bình luận của Preschool kèm tên công ty, bấm Ẩn ⇒ Hà không còn thấy", async ({
  browser,
}) => {
  const a = await open(browser, EA, WHO.tien);
  const c = card(a.page);
  await openThread(c);
  const cm = c.getByTestId("comment").filter({ hasText: NOTE });
  await expect(cm).toContainText(CO.b.name);
  await cm.getByRole("button", { name: "Ẩn bình luận" }).click();
  await expect(cm).toHaveClass(/hiddencmt/);
  await a.ctx.close();
  const b = await open(browser, EB, WHO.ha);
  const cb = card(b.page);
  await openThread(cb);
  await expect(cb.getByTestId("comment").filter({ hasText: NOTE })).toHaveCount(0);
  await b.ctx.close();
});

test("CR191-C3 · Tiên ngắt kết nối ⇒ Hà không còn thấy bài NitiGroup (mất cả ô bình luận)", async ({
  browser,
}) => {
  const a = await open(browser, EA, WHO.tien);
  await a.page.goto("/contracts/partners");
  await a.page.getByTestId("connected-toggle").click(); // CR-193: «Ngắt kết nối» nằm trong danh sách «Đang kết nối»
  await a.page.getByRole("button", { name: `Ngắt kết nối với ${CO.b.name}` }).click();
  await a.page
    .getByRole("dialog", { name: `Ngắt kết nối với ${CO.b.name}?` })
    .getByRole("button", { name: "Ngắt kết nối", exact: true })
    .click();
  await a.ctx.close();
  const b = await open(browser, EB, WHO.ha);
  await expect(b.page.getByTestId("post").filter({ hasText: TITLE })).toHaveCount(0);
  await b.ctx.close();
});
