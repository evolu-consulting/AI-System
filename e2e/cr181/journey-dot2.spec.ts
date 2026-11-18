// CR-182 · HÀNH TRÌNH ĐỢT 2 (công ty `dot2`: quy trình THEO VAI, vai CHƯA giao — `_cr181-stack.ts` `dot2Company`), mỗi bước do đúng vai làm, khác người tạo:
//   quản trị (giám đốc) GIAO VAI trên sơ đồ → sale chuẩn bị chỗ ký A/B → Gửi duyệt → trưởng phòng (người được giao) ký XOÈ QUẠT → Đạt → giám đốc (người ký theo vai) ký
//   → đối tác mở link (không tài khoản), tạo chữ ký nhanh, ký → HĐ «Đã ký» → Xem bản đã ký có chữ ký đối tác → Kiểm tra tệp khớp → phụ lục cần ký
//   → HĐ thứ hai: Gửi lại link (link cũ hết dùng), điện thoại 390px, đối tác TỪ CHỐI (lý do hiện ở trang HĐ) → link hết hạn.
// Link mời ký lấy từ log hub (`HUB_NOTIFY_MODE=off`): `readPartnerLink` (kit). Tệp «bản đã ký» lấy từ chính màn Xem bản đã ký (không gọi API riêng).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, U } from "../cr127/_cr127-kit";
import { withOwner } from "../support/helpers";
import {
  addMineAt,
  collectDiag,
  directorSigns,
  draftSample,
  HEAD,
  headSignsAndPasses,
  prepareSignPlaces,
  readPartnerLink,
  samplePdf,
  saveSigned,
  seedPartnerContact,
  stepEventually,
} from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf("dot2");
const RUN = Date.now().toString(36);
const GIAMDOC = "e2e-giamdoc";
const PARTNER_MAIL = "doi-tac-ky@e2e.test";
let id1 = "";
let id2 = "";
let link1 = "";
let link2a = "";
let link2b = "";
let signedPdf: Buffer | null = null;
const pathOf = (l: string): string => new URL(l).pathname;

/** Sale (người tạo): tải HĐ, đặt chỗ ký A/B, Gửi duyệt ⇒ bước «Trưởng phòng duyệt» mở. Trả id. */
async function saleSends(
  browser: import("@playwright/test").Browser,
  tag: string,
): Promise<string> {
  const sale = await newPage(browser);
  await loginCw(sale, E, U.employee);
  const id = await draftSample(sale, E, `${RUN}${tag}`);
  await seedPartnerContact(id, PARTNER_MAIL);
  await prepareSignPlaces(sale);
  await sale.goto(`${E.cw}/contracts/c/${id}`);
  await sale.getByRole("button", { name: "Gửi duyệt" }).click();
  await stepEventually(sale, id, "Trưởng phòng duyệt", "open");
  await sale.context().close();
  return id;
}

test("quản trị giao vai trên sơ đồ: «Trưởng phòng duyệt» và «Người ký hợp đồng» → nhóm, hết viền vàng", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.director);
  await page.goto(`${E.cw}/contracts/settings?sec=flow`);
  await expect(page.getByTestId("assign-status")).toContainText("Còn 2 vai chưa giao người", {
    timeout: 60_000,
  });
  // bước Ký chỉ chọn người theo vai: không còn «Ký qua» / «Người ký phía công ty»
  await expect(page.getByText("Ký qua", { exact: true })).toHaveCount(0);
  for (const [step, group] of [
    ["Trưởng phòng duyệt", "Trưởng phòng duyệt"],
    ["Ký hợp đồng", "Người ký hợp đồng"],
  ] as const) {
    const node = page.getByTestId("def-node-stage").filter({ hasText: step }).first();
    await expect(node).toHaveAttribute("data-unassigned", "1");
    await node.click();
    const panel = page.getByTestId("assign-panel");
    await panel.getByTestId("assign-group").click();
    await page.getByRole("option", { name: group, exact: true }).click();
    await panel.getByRole("button", { name: "Lưu giao việc" }).click();
    await page.getByTestId("assign-confirm").getByRole("button", { name: "Lưu giao việc" }).click();
    await expect(page.getByText("Đã lưu giao việc")).toBeVisible();
    await expect(node).not.toHaveAttribute("data-unassigned", "1");
  }
  await expect(page.getByTestId("assign-status")).toContainText("Mọi bước đã có người làm.");
  await page.context().close();
});

test("sale chuẩn bị chỗ ký A/B → Gửi duyệt; trưởng phòng (người được giao, KHÁC người tạo) ký xoè quạt → Đạt", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  id1 = await saleSends(browser, "1");
  const page = await newPage(browser);
  await loginCw(page, E, HEAD);
  await page.goto(`${E.cw}/contracts/c/${id1}`);
  await stepEventually(page, id1, "Trưởng phòng duyệt", "open");
  const take = page.getByTestId("claim-take");
  if (await take.isVisible({ timeout: 15_000 }).catch(() => false)) await take.click();
  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý");
  await page.getByTestId("approver-sign").getByRole("link", { name: "Mở và ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Xoè quạt" }).click();
  await expect(page.getByTestId("sign-page")).toHaveCount(5);
  await addMineAt(page, 0, 0.5, 0.5);
  await saveSigned(page, id1);
  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý");
  await page.getByTestId("request-approve-confirm").click();
  await stepEventually(page, id1, "Trưởng phòng duyệt", "passed");
  await page.context().close();
});

test("giám đốc (người ký theo vai) ký ⇒ Bên A đủ ⇒ HĐ chờ đối tác, có link ký", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await directorSigns(browser, E, id1, GIAMDOC);
  console.log(
    "[dot2-diag]",
    JSON.stringify(await collectDiag(E, id1, [U.employee])).slice(0, 5000),
  );
  const sale = await newPage(browser);
  await loginCw(sale, E, U.employee);
  await sale.goto(`${E.cw}/contracts/c/${id1}`);
  await expect(async () => {
    await sale.reload();
    await expect(sale.getByTestId("sign-partner-wait")).toContainText("Chờ", { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(sale.getByTestId("partner-link")).toContainText("Chưa mở");
  await sale.context().close();
  link1 = await readPartnerLink(E);
});

test("đối tác (không đăng nhập): mở link → tạo chữ ký nhanh → ký ô Bên B ⇒ «Bạn đã ký xong»", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPage(browser); // trình duyệt sạch: không phiên Evolu
  await page.goto(link1);
  await expect(page.getByTestId("partner-invite")).toContainText("mời bạn ký", { timeout: 30_000 });
  await page.getByRole("button", { name: "Xem và ký" }).click();
  const quick = page.getByTestId("partner-quick");
  await quick.getByRole("textbox", { name: "Họ tên" }).fill("Trần Thị B");
  await quick.getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await page.getByRole("button", { name: /^Lưu/ }).first().click();
  await page.getByTestId("sign-confirm").getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(page.getByTestId("partner-signed")).toContainText("Bạn đã ký xong", {
    timeout: 60_000,
  });
  await page.context().close();
});

test("sale: HĐ «Đã ký»; Xem bản đã ký có thêm bản sau đối tác ký", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id1}`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("sign-partner-wait")).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByTestId("signers-strip")).toContainText("Đã ký", { timeout: 60_000 });
  const content = page.waitForResponse(
    (r) => r.request().method() === "GET" && /\/sign-docs\/[^/]+\/content$/.test(r.url()),
  );
  await page.getByRole("link", { name: "Xem bản đã ký" }).first().click();
  await expect(page.getByTestId("signed-viewer")).toBeVisible({ timeout: 30_000 });
  signedPdf = Buffer.from(await (await content).body());
  await page.getByTestId("viewer-version").click();
  // Bản gốc + sau trưởng phòng + sau giám đốc + sau đối tác
  await expect(page.getByRole("option")).toHaveCount(4);
  await expect(page.getByRole("option", { name: /^Sau khi .* ký/ })).toHaveCount(3);
  await page.context().close();
});

test("kiểm tra tệp: bản đã ký ⇒ khớp; tệp gốc ⇒ khớp tệp gốc; PDF lạ ⇒ không khớp", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  expect(signedPdf, "ca trước phải lấy được bản đã ký").not.toBeNull();
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/verify`);
  const input = page.getByTestId("verify-file");
  await input.setInputFiles({
    name: "da-ky.pdf",
    mimeType: "application/pdf",
    buffer: signedPdf as Buffer,
  });
  await expect(page.getByTestId("verify-hit")).toContainText("Khớp", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Xem bản đã ký" })).toBeVisible();
  await input.setInputFiles({
    name: "la.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 tệp lạ không phải HĐ nào của công ty"),
  });
  await expect(page.getByTestId("verify-miss")).toContainText("Không khớp bản nào đã lưu", {
    timeout: 30_000,
  });
  await page.context().close();
});

test("phụ lục cần ký: sale thêm phụ lục trên HĐ đã ký ⇒ phụ lục dưới HĐ gốc, Gửi duyệt ⇒ trưởng phòng có việc", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id1}`);
  await expect(page.getByTestId("annex-add")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("annex-file").setInputFiles({
    name: "phu-luc-1.pdf",
    mimeType: "application/pdf",
    buffer: await samplePdf(),
  });
  await expect(page).toHaveURL(/\/contracts\/c\/(?!${id1})/, { timeout: 60_000 });
  const annexId = new URL(page.url()).pathname.split("/").pop() as string;
  expect(annexId).not.toBe(id1);
  await expect(page.getByTestId("appendix-readonly")).toBeVisible({ timeout: 30_000 });
  await prepareSignPlaces(page);
  await page.goto(`${E.cw}/contracts/c/${annexId}`);
  const send = page.getByRole("button", { name: "Gửi duyệt" });
  await expect(send).toBeEnabled({ timeout: 60_000 });
  await send.click();
  await stepEventually(page, annexId, "Trưởng phòng duyệt", "open");
  // HĐ gốc giữ nguyên «Đã ký» và liệt kê phụ lục
  await page.goto(`${E.cw}/contracts/c/${id1}`);
  await expect(page.getByTestId("annex-state").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("signers-strip")).toContainText("Đã ký");
  await page.context().close();
});

test("HĐ thứ hai: Gửi lại link ⇒ link cũ hết dùng; điện thoại 390px; đối tác TỪ CHỐI ⇒ lý do hiện ở trang HĐ", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  id2 = await saleSends(browser, "2");
  await headSignsAndPasses(browser, E, id2);
  await directorSigns(browser, E, id2, GIAMDOC);
  link2a = await readPartnerLink(E, [pathOf(link1)]);

  const sale = await newPage(browser);
  await loginCw(sale, E, U.employee);
  await sale.goto(`${E.cw}/contracts/c/${id2}`);
  await expect(async () => {
    await sale.reload();
    await expect(sale.getByTestId("sign-partner-wait")).toContainText("Chờ", { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await sale.getByTestId("sign-partner-wait").getByRole("button", { name: "Gửi lại link" }).click();
  await expect(sale.getByText(/Đã gửi lại link tới/)).toBeVisible({ timeout: 30_000 });
  link2b = await readPartnerLink(E, [pathOf(link1), pathOf(link2a)]);
  expect(pathOf(link2b)).not.toBe(pathOf(link2a));
  await sale.context().close();

  // link cũ không dùng được nữa
  const old = await newPage(browser);
  await old.goto(link2a);
  await expect(old.getByRole("button", { name: "Xem và ký" })).toHaveCount(0);
  await expect(old.getByTestId("partner-gone").or(old.getByTestId("partner-notfound"))).toBeVisible(
    { timeout: 30_000 },
  );
  await old.context().close();

  // 390px: không tràn ngang, nút ≥ 44px
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "vi-VN" });
  const phone = await ctx.newPage();
  await phone.goto(link2b);
  await expect(phone.getByTestId("partner-invite")).toBeVisible({ timeout: 30_000 });
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const btn = await phone.getByRole("button", { name: "Xem và ký" }).boundingBox();
  expect(btn?.height ?? 0).toBeGreaterThanOrEqual(44);
  await ctx.close();

  // đối tác từ chối, ghi lý do
  const partner = await newPage(browser);
  await partner.goto(link2b);
  await partner.getByRole("button", { name: "Từ chối ký" }).click();
  const dlg = partner.getByTestId("partner-decline");
  await dlg.getByRole("button", { name: "Từ chối ký" }).click(); // thiếu lý do ⇒ chặn
  await expect(dlg).toContainText("Nhập lý do từ chối.");
  await dlg.getByRole("textbox", { name: "Lý do" }).fill("Cần sửa điều khoản thanh toán");
  await dlg.getByRole("button", { name: "Từ chối ký" }).click();
  await expect(partner.getByTestId("partner-declined")).toContainText("Cần sửa điều khoản", {
    timeout: 60_000,
  });
  await partner.context().close();

  const after = await newPage(browser);
  await loginCw(after, E, U.employee);
  await after.goto(`${E.cw}/contracts/c/${id2}`);
  await expect(after.getByTestId("partner-link")).toContainText("Cần sửa điều khoản thanh toán", {
    timeout: 60_000,
  });
  await after.context().close();
});

test("link hết hạn ⇒ câu báo rõ ràng, không có nút ký", async ({ browser }) => {
  test.setTimeout(120_000);
  // HĐ 1 đã ký xong; đẩy hạn về quá khứ (như hết 7 ngày) và coi như chưa ký để xem trang «hết hạn»
  await withOwner(async (sql) => {
    await sql`update contracts.partner_sign_links set expires_at = now() - interval '1 minute', signed_at = null where contract_id = ${id1}::uuid`;
  });
  const page = await newPage(browser);
  await page.goto(link1);
  const gone = page.getByTestId("partner-gone");
  await expect(gone).toBeVisible({ timeout: 30_000 });
  await expect(gone).toContainText("hết hạn");
  await expect(page.getByRole("button", { name: "Xem và ký" })).toHaveCount(0);
  await page.context().close();
});
