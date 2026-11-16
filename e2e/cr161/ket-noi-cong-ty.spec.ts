// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-161 · hành trình «kết nối hai công ty, không cần hợp đồng» (CR-169: trò chuyện chuyển sang Tin nhắn — phần nhắn tin ở e2e/cr169; G4, N2: mỗi bước đúng vai, khác người tạo). VIẾT trong lát, chạy trên evotest.
// Công ty/người: `e2e/_kit/two-companies.ts`. Nhãn nguyên văn theo spec §8 + i18n `contracts.connect.*`. Không sleep: chờ theo điều kiện (stream đẩy chuông/tin).
import { type Browser, expect, type Page, test } from "@playwright/test";
import { apiLogin, tenantIdByKey } from "../_kit/api";
import { CO, POST_BODY, POST_BODY_B, WHO } from "../_kit/two-companies";
import { type Env, loginCw } from "../journey-approval/_journey";

// Mặc định (không serial) + 1 worker: ca đỏ không làm các ca sau bị bỏ qua.

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.cr161.config.ts)`);
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
const RUN = need("CR161_RUN");
const NOTE = `Mong hai bên hợp tác ${RUN}`;

const open = async (browser: Browser, e: Env, user: string) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, e, user);
  return { ctx, page };
};
const bell = async (page: Page, text: string) => {
  await page.getByTestId("topbar-bell").getByRole("button").first().click();
  const dlg = page.getByRole("dialog", { name: "Thông báo" });
  const item = dlg.getByText(text).first();
  await expect(item).toBeVisible({ timeout: 30_000 });
  return item;
};
const partnerUrl = (tenantId: string, other: "a" | "b") =>
  `/contracts/partners?party=${encodeURIComponent(`tax:${CO[other].tax}`)}&tenant=${tenantId}&tab=chat`; // đường dẫn cũ: CR-169 đổi về Tổng quan
/** CR-178 · công ty đối tác trong menu «Đối tác ▾» của Tin nhắn (khớp một phần tên: tên công ty hoặc tên pháp lý). */
const partnerItem = async (page: Page, name: string) => {
  await page.getByTestId("tab-partner").click();
  return page.getByTestId("partner-item").filter({ hasText: new RegExp(name) });
};
/** Mở cuộc nhắn riêng với một người của công ty đối tác bằng «Nhắn tin mới › Đối tác» (có cuộc thì «Bảng tin» ở đầu khung chat mới hiện). */
const openPartnerChat = async (page: Page) => {
  await page.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = page.getByTestId("new-conv-dialog");
  await dlg.getByTestId("new-tab-partner").click();
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
};
const tabOf = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
let tenantA = "";
let tenantB = "";

test.beforeAll(async () => {
  const p = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  tenantA = await tenantIdByKey(need("JA_API_URL"), p, EA.tenantKey);
  tenantB = await tenantIdByKey(need("JA_API_URL"), p, EB.tenantKey);
});

test("CR161-J1 · Tiên (NitiGroup) tìm Preschool, gửi lời mời kèm lời nhắn ⇒ thấy «Đã gửi lời mời — chờ trả lời»", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.tien);
  await page.goto("/contracts/partners");
  await page.getByRole("button", { name: "Tìm công ty" }).click();
  const dlg = page.getByRole("dialog", { name: "Tìm công ty để kết nối" });
  await dlg.getByLabel("Tên công ty hoặc mã số thuế").fill("Preschool");
  const row = dlg.getByTestId("connect-results").getByRole("listitem").first();
  await expect(row).toContainText(CO.b.name);
  await expect(row).toContainText("Chưa kết nối");
  await row.getByRole("button", { name: "Gửi lời mời kết nối" }).click();
  const confirm = page.getByRole("dialog", { name: `Gửi lời mời cho ${CO.b.name}?` });
  await confirm.getByLabel("Lời nhắn kèm lời mời (tuỳ chọn)").fill(NOTE);
  await confirm.getByRole("button", { name: "Gửi lời mời", exact: true }).click();
  await expect(row).toContainText("Đã gửi lời mời — chờ trả lời");
  await ctx.close();
});

test("CR161-J2 · Dung (Preschool, Toàn quyền, không phải người mời) thấy chuông + băng lời mời kèm lời nhắn, bấm Đồng ý", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EB, WHO.dung);
  await (await bell(page, `${CO.a.name} muốn kết nối với bạn`)).click();
  await expect(page).toHaveURL(/\/contracts\/partners\?.*invites=1/);
  const band = page.getByTestId("connect-invite").filter({ hasText: CO.a.name });
  await expect(band).toContainText(`Lời nhắn: «${NOTE}»`);
  await band.getByRole("button", { name: "Đồng ý", exact: true }).click();
  await expect(band).toHaveCount(0);
  await expect(page.getByTestId("connected-list")).toContainText(CO.a.name);
  await expect(page.getByTestId("connected-list")).toContainText("Đã kết nối");
  await ctx.close();
});

test("CR161-J3 · Tiên thấy Preschool «Đã kết nối», bấm «Nhắn tin» ⇒ Tin nhắn lọc đúng công ty (chip bật)", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.tien);
  await page.goto("/contracts/partners");
  const list = page.getByTestId("connected-list");
  await expect(list).toContainText(CO.b.name);
  await expect(list).toContainText("Đã kết nối");
  await list.getByRole("link", { name: "Nhắn tin", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/messages?.*company=${tenantB}`));
  await expect(page.getByTestId("tab-partner")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tab-partner")).toContainText(CO.b.name);
  await ctx.close();
});

test("CR161-J3b · Tiên mở trang đối tác của công ty đã kết nối: chỉ 3 tab, không «Trò chuyện» / «Bảng tin công ty» / «Thao tác»", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.tien);
  await page.goto("/contracts/partners");
  await page.getByTestId("connected-list").getByRole("link", { name: "Mở trang đối tác" }).click();
  await expect(page.getByRole("tablist", { name: "Thông tin đối tác" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText([
    /^Tổng quan$/,
    /^Hợp đồng/,
    /^Sổ việc & ghi chú$/,
  ]);
  await expect(tabOf(page, "Trò chuyện")).toHaveCount(0);
  await expect(tabOf(page, "Bảng tin công ty")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thao tác", exact: true })).toHaveCount(0);
  // đường dẫn cũ `?tab=chat` ⇒ về Tổng quan
  await page.goto(partnerUrl(tenantB, "b"));
  await expect(tabOf(page, "Tổng quan")).toHaveAttribute("aria-selected", "true");
  await ctx.close();
});

test("CR161-J4 · Dung (Preschool) › Tin nhắn › chip NitiGroup › «Bảng tin NitiGroup-test» thấy bài công khai của NitiGroup", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EB, WHO.dung);
  await page.goto(`/contracts/messages?company=${tenantA}`);
  await expect(page.getByTestId("tab-partner")).toHaveAttribute("aria-pressed", "true");
  await openPartnerChat(page);
  await page.getByTestId("open-feed").click(); // CR-178: nút ở đầu khung chat cuộc đối tác
  const dlg = page.getByTestId("feed-dialog");
  await expect(dlg.getByTestId("feed-post").filter({ hasText: POST_BODY })).toBeVisible();
  await ctx.close();
});

test("CR161-J5 · N2: Thanh (Toàn quyền khác của NitiGroup, không phải người mời) cũng thấy Preschool đã kết nối và Bảng tin Preschool", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.thanh);
  await page.goto("/contracts/partners");
  await expect(page.getByTestId("connected-list")).toContainText(CO.b.name);
  await page.goto(`/contracts/messages?company=${tenantB}`);
  await openPartnerChat(page);
  await page.getByTestId("open-feed").click();
  await expect(
    page.getByTestId("feed-dialog").getByTestId("feed-post").filter({ hasText: POST_BODY_B }),
  ).toBeVisible();
  await ctx.close();
});

test("CR161-J6 · Vy (nhân viên NitiGroup): không nút «Tìm công ty», chỉ băng giải thích", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.vy);
  await page.goto("/contracts/partners");
  await expect(page.getByTestId("connect-staff-note")).toContainText(
    "Chỉ người có quyền Toàn quyền mới gửi hoặc nhận lời mời kết nối.",
  );
  await expect(page.getByRole("button", { name: "Tìm công ty" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gửi lời mời kết nối" })).toHaveCount(0);
  await expect(page.getByTestId("connected-list")).toHaveCount(0);
  // API cũng chặn: nhân viên gọi danh sách kết nối ⇒ 403 (R1); nhưng CR-169: vẫn thấy chip công ty đã kết nối trong Tin nhắn
  const s = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: EA.tenantKey,
    username: WHO.vy,
    password: EA.pw,
    app: "contracts",
  });
  const r = await fetch(
    `${need("JA_HUB_URL")}/pack/contracts/connect/links?status=connected&limit=50`,
    {
      headers: s.headers,
    },
  );
  expect(r.status).toBe(403);
  await page.goto("/contracts/messages");
  await expect(await partnerItem(page, CO.b.name)).toBeVisible();
  await ctx.close();
});

test("CR161-J7 · Tiên ngắt kết nối ⇒ chip NitiGroup biến mất ở Tin nhắn của Dung", async ({
  browser,
}) => {
  const a = await open(browser, EA, WHO.tien);
  await a.page.goto("/contracts/partners");
  await a.page.getByRole("button", { name: `Ngắt kết nối với ${CO.b.name}` }).click();
  await a.page
    .getByRole("dialog", { name: `Ngắt kết nối với ${CO.b.name}?` })
    .getByRole("button", { name: "Ngắt kết nối", exact: true })
    .click();
  await expect(a.page.getByTestId("connected-list")).toHaveCount(0);
  await a.ctx.close();

  const b = await open(browser, EB, WHO.dung);
  await b.page.goto("/contracts/messages");
  await expect(b.page.getByTestId("list-tabs")).toBeVisible();
  await expect(await partnerItem(b.page, CO.a.name)).toHaveCount(0);
  await b.ctx.close();
});
