// CR-129 · HÀNH TRÌNH THẬT (D5, không mock) trên stack community-web (playwright.stack.config.ts, chỉ nhận `*.cs.ts`). VIẾT, CHƯA CHẠY.
// Bình luận phẳng + @ nhắc công ty đối tác + chuông `mention` + Composer chọn nhóm hàng + hồ sơ `/community/me`.
// Dữ liệu đi đường người dùng: bài của chủ quản qua API đăng bài (như bấm Đăng), bình luận/@ bằng giao diện,
// đồng nghiệp của đối tác = user thứ hai trong tài khoản công ty (admin-api) đăng bài bằng ô soạn.
//  M1 · Chủ quản bình luận (không bước ẩn); @ chọn Tân Phát ⇒ Gửi ⇒ Tân Phát: chuông «nhắc», bấm ⇒ đúng bài + cuộn tới bình luận.
//  M2 · Tân Phát bình luận; ABC thấy bình luận của chủ quản, KHÔNG thấy của Tân Phát; ABC/Tân Phát gõ @ không có popover.
//  M3 · Composer: nhóm hàng chọn qua hộp thoại (cat-pick-btn → cat-pick-done); nút Đính kèm chỉ biểu tượng.
//  M4 · /community/me: 2 tab; tab «Bài đăng của tổ chức» có bài của đồng nghiệp, tab «Bài đăng của tôi» không có.
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, createPost, pageFetch, tenantIdByKey } from "../_kit/api";
import { NEW_PW, ORG, openAs, postByTitle, TENANT, USERNAME } from "./_stack";

/* biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo) */
const API = process.env.CS_API_URL ?? "";
const RUN = Date.now().toString(36);
const POST = `Bài thử bình luận ${RUN}`;
const C_HOST = `Chủ quản trả lời ${RUN}`;
const C_SUP = `Tân Phát phản hồi ${RUN}`;
const COLLEAGUE_POST = `Hàng của đồng nghiệp ${RUN}`;
const state: { hostCommentId?: string; colleague?: { username: string; pw: string } } = {};

const thread = (p: Page) => postByTitle(p, POST).getByTestId("thread");
const box = (p: Page) => thread(p).getByRole("combobox", { name: "Viết bình luận" });
const openComments = (p: Page) =>
  postByTitle(p, POST)
    .getByRole("button", { name: /Bình luận/ })
    .click();

async function openFeedWithPost(p: Page) {
  await expect(async () => {
    await p.goto("/community");
    await expect(postByTitle(p, POST)).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // bài của chủ quản cho mọi bạn bè (đường API như bấm Đăng)
  const host = await openAs(browser, "host");
  const s = await apiLogin({
    fx: pageFetch(host.page),
    base: "",
    tenantKey: TENANT,
    username: USERNAME.host,
    password: process.env.DEMO_OWNER_PW ?? "",
    app: "contracts",
  });
  await createPost("", s, { type: "note", body: POST, audience: { mode: "all" } });
  await host.ctx.close();
});

test("CR129-M1 · chủ quản bình luận ngay trên bài của mình, gõ @ chọn Tân Phát ⇒ Gửi ⇒ Tân Phát thấy chuông nhắc, bấm mở đúng bài và cuộn tới bình luận", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const host = await openAs(browser, "host");
  const h = host.page;
  await h.goto("/community");
  await openComments(h);
  await expect(box(h)).toBeVisible(); // không bước ẩn: mở bình luận là có ô nhập
  await box(h).click();
  await box(h).pressSequentially("@Tân");
  await expect(h.getByTestId("mention-popover")).toBeVisible();
  const opt = h.getByTestId("mention-option").filter({ hasText: ORG.supplier });
  await expect(opt).toHaveCount(1);
  await expect(h.getByTestId("mention-option").filter({ hasText: ORG.buyer })).toHaveCount(0); // lọc theo chữ đã gõ
  await opt.click();
  await box(h).pressSequentially(` ${C_HOST}`);
  await thread(h).getByRole("button", { name: "Gửi bình luận" }).click();
  const mine = thread(h).locator("[data-comment-id]").filter({ hasText: C_HOST });
  await expect(mine).toBeVisible();
  await expect(mine.getByTestId("mention-tag")).toContainText(ORG.supplier);
  state.hostCommentId = (await mine.getAttribute("data-comment-id")) ?? "";
  expect(state.hostCommentId).not.toBe("");
  await host.ctx.close();

  // Tân Phát: chuông có thông báo nhắc tên công ty
  const sup = await openAs(browser, "supplier");
  const p = sup.page;
  await p.goto("/community");
  await p.getByTestId("topbar-bell").getByRole("button").first().click();
  const dlg = p.getByRole("dialog", { name: "Thông báo" });
  await expect(dlg).toBeVisible();
  const item = dlg.getByText(/nhắc/).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(p).toHaveURL(new RegExp(`comment=${state.hostCommentId}`));
  await expect(postByTitle(p, POST)).toBeVisible();
  await expect(p.locator(`[data-comment-id="${state.hostCommentId}"]`)).toBeInViewport();
  await expect(p.locator(`[data-comment-id="${state.hostCommentId}"]`)).toContainText(C_HOST);
  await sup.ctx.close();
});

test("CR129-M2 · Tân Phát bình luận; ABC (cùng thấy bài) thấy bình luận của chủ quản nhưng KHÔNG thấy bình luận của Tân Phát; đối tác không có popover @", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const sup = await openAs(browser, "supplier");
  await openFeedWithPost(sup.page);
  await openComments(sup.page);
  await box(sup.page).click();
  await box(sup.page).pressSequentially("@");
  await expect(sup.page.getByTestId("mention-popover")).toHaveCount(0); // đối tác không nhắc được ai
  await box(sup.page).fill(C_SUP);
  await thread(sup.page).getByRole("button", { name: "Gửi bình luận" }).click();
  await expect(thread(sup.page)).toContainText(C_SUP);
  await sup.ctx.close();

  const buyer = await openAs(browser, "buyer");
  await openFeedWithPost(buyer.page);
  await openComments(buyer.page);
  await expect(thread(buyer.page)).toContainText(C_HOST); // bình luận của chủ quản: bạn bè thấy
  await expect(thread(buyer.page)).not.toContainText(C_SUP); // đối tác không thấy nhau
  await box(buyer.page).click();
  await box(buyer.page).pressSequentially("@");
  await expect(buyer.page.getByTestId("mention-popover")).toHaveCount(0);
  await buyer.ctx.close();
});

test("CR129-M3 · Composer: chọn nhóm hàng qua hộp thoại (cat-pick-btn → cat-pick-done); nút Đính kèm chỉ biểu tượng", async ({
  browser,
}) => {
  const host = await openAs(browser, "host");
  const p = host.page;
  await p.goto("/community");
  await p
    .getByTestId("composer")
    .getByRole("button", { name: /đang có hàng/ })
    .click();
  const attach = p.getByTestId("composer").getByRole("button", { name: "Đính kèm" });
  await expect(attach).toBeVisible();
  await expect(attach).toHaveText(""); // chỉ biểu tượng, nhãn nằm ở aria-label
  await p.getByRole("button", { name: "Chọn người xem" }).click();
  await p.getByRole("button", { name: "Theo nhóm hàng" }).click();
  await p.getByTestId("cat-pick-btn").click();
  const dlg = p.getByRole("dialog", { name: "Chọn nhóm hàng" });
  await expect(dlg).toBeVisible();
  const first = dlg.getByTestId("cat-list").getByRole("checkbox").first();
  await first.check();
  await expect(dlg).toContainText("Đã chọn 1 nhóm");
  await dlg.getByTestId("cat-pick-done").click();
  await expect(dlg).toHaveCount(0);
  await expect(p.getByTestId("cat-pick-btn")).not.toHaveText("Chọn nhóm hàng"); // nút hiện nhóm đã chọn
  await host.ctx.close();
});

test("CR129-M4 · /community/me có 2 tab; «Bài đăng của tổ chức» có bài của đồng nghiệp, «Bài đăng của tôi» không có", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  // đồng nghiệp: user thứ hai trong tài khoản công ty Tân Phát (đường admin-api), tự đăng bài bằng ô soạn
  const adm = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: process.env.SEED_ADMIN_USERNAME ?? "",
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
  });
  const h = { "content-type": "application/json", authorization: `Bearer ${adm.token}` };
  const tid = await tenantIdByKey(API, adm, TENANT);
  const orgs = await fetch(`${API}/admin/external-orgs?tenant_id=${tid}`, { headers: h });
  const oj = (await orgs.json()) as
    | { items?: { id: string; name: string }[] }
    | { id: string; name: string }[];
  const org = (Array.isArray(oj) ? oj : (oj.items ?? [])).find((o) => o.name === ORG.supplier);
  expect(org, "tài khoản công ty Tân Phát").toBeTruthy();
  const username = `cr129-dn-${RUN}`;
  const u = await fetch(`${API}/admin/external-orgs/${org?.id}/users`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      username,
      display_name: `Đồng nghiệp ${RUN}`,
      email: `${username}@example.test`,
    }),
  });
  expect(u.status, "tạo đồng nghiệp").toBe(201);
  state.colleague = {
    username,
    pw: ((await u.json()) as { temp_password: string }).temp_password,
  };

  const ctx = await browser.newContext({ baseURL: process.env.COMMUNITY_URL });
  const page = await ctx.newPage();
  await page.goto("/login?next=%2Fcommunity");
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(TENANT);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)/ }).fill(username);
  await pw.fill(state.colleague.pw);
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  const change = page.getByRole("heading", { name: "Đặt mật khẩu mới" });
  const composer = page.getByTestId("composer");
  await expect(change.or(composer)).toBeVisible({ timeout: 45_000 });
  if (await change.isVisible()) {
    const fields = page.locator("input[type=password]");
    for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(NEW_PW);
    await page.locator("button[type=submit]").first().click();
  }
  await expect(composer).toBeVisible({ timeout: 45_000 });
  await composer.getByRole("button", { name: "Cần bán", exact: true }).click();
  await page.getByLabel("Hàng hoá", { exact: true }).fill(COLLEAGUE_POST);
  await page.getByLabel("Số lượng").fill("5 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  await expect(postByTitle(page, COLLEAGUE_POST).first()).toBeVisible();
  await ctx.close();

  // người dùng Tân Phát (đồng nghiệp): hồ sơ của tôi
  const sup = await openAs(browser, "supplier");
  const p = sup.page;
  await p.goto("/community");
  await p.getByRole("button", { name: "Tài khoản" }).click();
  await p.getByRole("menuitem", { name: "Hồ sơ của tôi" }).click();
  await expect(p).toHaveURL(/\/community\/me/);
  await expect(p.getByRole("tab")).toHaveCount(2);
  await expect(p.getByRole("tab", { name: "Bài đăng của tôi" })).toBeVisible();
  await expect(p.getByRole("tab", { name: "Bài đăng của tổ chức" })).toBeVisible();
  await p.getByRole("tab", { name: "Bài đăng của tôi" }).click();
  await expect(postByTitle(p, COLLEAGUE_POST)).toHaveCount(0);
  await p.getByRole("tab", { name: "Bài đăng của tổ chức" }).click();
  await expect(postByTitle(p, COLLEAGUE_POST).first()).toBeVisible();
  await sup.ctx.close();
});
