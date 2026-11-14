// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-161 · hành trình «kết nối hai công ty, không cần hợp đồng» (G4, N2: mỗi bước đúng vai, khác người tạo). VIẾT trong lát, chạy trên evotest.
// Công ty/người: `e2e/_kit/two-companies.ts`. Nhãn nguyên văn theo spec §8 + i18n `contracts.connect.*`. Không sleep: chờ theo điều kiện (stream đẩy chuông/tin).
import { type Browser, expect, type Page, test } from "@playwright/test";
import { apiLogin, tenantIdByKey } from "../_kit/api";
import { CO, POST_BODY, WHO } from "../_kit/two-companies";
import { type Env, loginCw } from "../journey-approval/_journey";

test.describe.configure({ mode: "serial" });

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
const RUN = Date.now().toString(36);
const NOTE = `Mong hai bên hợp tác ${RUN}`;
const HELLO = `Chào Preschool, gửi báo giá ${RUN}`;
const REPLY = `NitiGroup nhận được, cảm ơn ${RUN}`;
const FILE = `bao-gia-${RUN}.pdf`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

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
  `/contracts/partners?party=${encodeURIComponent(`tax:${CO[other].tax}`)}&tenant=${tenantId}&tab=chat`;
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

test("CR161-J3 · Tiên thấy Preschool «Đã kết nối», mở tab «Trò chuyện», nhắn kèm tệp PDF", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.tien);
  await page.goto("/contracts/partners");
  const list = page.getByTestId("connected-list");
  await expect(list).toContainText(CO.b.name);
  await expect(list).toContainText("Đã kết nối");
  await list.getByRole("link", { name: "Mở trang đối tác" }).click();
  await tabOf(page, "Trò chuyện").click();
  await page.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(HELLO);
  await page.getByTestId("cc-file-input").setInputFiles({
    name: FILE,
    mimeType: "application/pdf",
    buffer: PDF,
  });
  // tệp tải lên ngay khi chọn: chờ thẻ «Tệp sẽ gửi» có tên tệp và hết «Đang tải lên…» rồi mới bấm Gửi
  const drafts = page.getByLabel("Tệp sẽ gửi");
  await expect(drafts).toContainText(FILE);
  await expect(drafts).not.toContainText("Đang tải lên…");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  const msg = page.getByTestId("cc-message").filter({ hasText: HELLO });
  await expect(msg).toBeVisible();
  await expect(msg).toContainText(FILE);
  await ctx.close();
});

test("CR161-J4 · Dung mở chuông «Tin nhắn mới…», thấy tin + tệp, tải được tệp, trả lời, tab «Bảng tin công ty» thấy bài công khai của NitiGroup", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EB, WHO.dung);
  await (await bell(page, `Tin nhắn mới từ ${CO.a.name}`)).click();
  const msg = page.getByTestId("cc-message").filter({ hasText: HELLO });
  await expect(msg).toBeVisible();
  await expect(msg).toContainText(FILE);
  const down = page.waitForEvent("download");
  await msg.getByTestId("file-download").first().click();
  expect((await down).suggestedFilename()).toBe(FILE);
  await page.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(REPLY);
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByTestId("cc-message").filter({ hasText: REPLY })).toBeVisible();
  await tabOf(page, "Bảng tin công ty").click();
  await expect(
    page.getByText(`Bạn đang xem bài công khai của công ty đã kết nối: ${CO.a.name}.`),
  ).toBeVisible();
  await expect(page.getByTestId("cc-post").filter({ hasText: POST_BODY })).toBeVisible();
  await ctx.close();
});

test("CR161-J5 · N2: Thanh (Toàn quyền khác của NitiGroup, không phải người mời) cũng thấy cuộc trò chuyện và câu trả lời của Dung", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, EA, WHO.thanh);
  await page.goto("/contracts/partners");
  await expect(page.getByTestId("connected-list")).toContainText(CO.b.name);
  await page.goto(partnerUrl(tenantB, "b"));
  await expect(page.getByTestId("cc-message").filter({ hasText: HELLO })).toBeVisible();
  await expect(page.getByTestId("cc-message").filter({ hasText: REPLY })).toBeVisible();
  await ctx.close();
});

test("CR161-J6 · Vy (nhân viên NitiGroup): không nút «Tìm công ty», không tab «Trò chuyện» / «Bảng tin công ty», chỉ băng giải thích", async ({
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
  await page.goto(partnerUrl(tenantB, "b"));
  await expect(page.getByRole("tablist")).toBeVisible();
  await expect(tabOf(page, "Trò chuyện")).toHaveCount(0);
  await expect(tabOf(page, "Bảng tin công ty")).toHaveCount(0);
  await expect(page.getByTestId("cc-message")).toHaveCount(0);
  await ctx.close();
});

test("CR161-J7 · Tiên ngắt kết nối ⇒ Dung thấy tin cũ, không có ô soạn, tab «Bảng tin công ty» ẩn", async ({
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
  await b.page.goto(partnerUrl(tenantA, "a"));
  await expect(b.page.getByTestId("cc-readonly")).toContainText(
    "Đã ngắt kết nối — chỉ xem lại tin cũ.",
  );
  await expect(b.page.getByTestId("cc-message").filter({ hasText: HELLO })).toBeVisible();
  await expect(b.page.getByRole("textbox", { name: "Nhập tin nhắn" })).toHaveCount(0);
  await expect(tabOf(b.page, "Bảng tin công ty")).toHaveCount(0);
  await b.ctx.close();
});
