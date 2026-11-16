// CR-150 · hành trình 2 công ty (bản đối chiếu với UAT `docs/uat/hop-dong-2-cong-ty.md`): A (nhân viên tạo) → Giám đốc A duyệt → chọn đối tác B (người chọn ≠ người tạo ≠ người thêm đối tác)
// → B nhận (lời mời nối lần đầu) → B duyệt nội bộ → A thấy kết quả; nhánh B Trả lại / Từ chối → A thấy lý do. N2: mỗi bước đúng vai, khác người tạo.
// Dùng cặp q6a → q6b (j07: Nhận HĐ KHÔNG có bước Ký — cặp d5a → d5b của j08 có bước Ký sau «Giám đốc nhận duyệt» (CR-146b) nên duyệt xong B còn chờ ký) và quy trình dựng bởi `e2e/cr127/_cr127-stack.ts` (đã có Gửi đối tác + Nhận HĐ). VIẾT, CHƯA CHẠY (điều phối chạy cuối đợt trên evotest);
// chạy qua `e2e/cr127/playwright.cr127.config.ts` (testMatch có spec này); A thấy kết quả B ở thẻ `partner-round` (khối «Gửi đối tác»).
import { safeReload } from "../_kit/ui";
import {
  contractRows,
  envOf,
  expect,
  loginCw,
  newPage,
  SPEC_TENANT,
  sendFromA,
  U,
} from "../cr127/_cr127-kit";
import { test } from "./_test";

test.describe.configure({ mode: "serial" });
const [KA, KB] = SPEC_TENANT.j07;
const [EA, EB] = [envOf(KA), envOf(KB)];
const RUN = Date.now().toString(36);
// «Giám đốc nhận duyệt» là bước nhóm (Ban Giám đốc, `need=one`, CR-127 U4): nút Duyệt/Trả lại/Từ chối chỉ hiện SAU «Nhận việc»
const claim = async (page: import("@playwright/test").Page): Promise<void> => {
  const take = page.getByTestId("claim-take");
  const act = page.locator("[data-approval]").first();
  await expect(take.or(act).first()).toBeVisible({ timeout: 60_000 });
  if (await take.isVisible()) {
    await take.click();
    await expect(page.getByTestId("claim-state")).toContainText("Bạn đang giữ");
  }
};
const rowOf = (page: import("@playwright/test").Page, run: string) =>
  contractRows(page)
    .filter({ hasText: `E2E-JOURNEY-${run}` })
    .first();

// B xác nhận xong thì hộp thư đã «replied» TRƯỚC khi tin báo về công ty A được phát (job nền ⇒ vòng của A còn «open» vài giây) và trang A không tự làm mới
// ⇒ chờ đúng điều kiện: tải lại (đợi refresh token xong) tới khi thẻ `partner-round` hiện kết quả. Không sleep.
const expectRound = async (
  page: import("@playwright/test").Page,
  run: string,
  re: RegExp,
): Promise<void> => {
  await page.goto("/contracts/list");
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(page);
    // sau tải lại, trang chi tiết có thể đã mở sẵn (không còn dòng danh sách) ⇒ chỉ bấm dòng khi nó đang hiện
    const row = rowOf(page, run);
    if (await row.isVisible()) await row.click();
    await expect(page.getByTestId("partner-round").first()).toContainText(re, { timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  // ba hợp đồng gửi từ A (nhân viên A tạo; Giám đốc A duyệt + chọn đối tác): đồng ý / trả lại / từ chối
  for (const r of ["ok", "tl", "tc"]) await sendFromA(browser, EA, KB, `${RUN}${r}`);
});

test("B nhận lời mời nối rồi thấy hợp đồng của A ở danh sách Đối tác gửi", async ({ browser }) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list");
  const invite = b.getByTestId("partner-invite").first();
  if (await invite.isVisible()) await invite.getByRole("button", { name: /Nhận/ }).click();
  await b.goto("/contracts/list?source=partner");
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(b);
    await expect(rowOf(b, `${RUN}ok`)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
});

test("B duyệt nội bộ (Giám đốc B) ⇒ A (nhân viên tạo) thấy đối tác đã xác nhận", async ({
  browser,
}) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list?source=partner");
  await rowOf(b, `${RUN}ok`).click();
  await claim(b);
  await b.locator("[data-approval=approve], [data-approval=pass]").first().click();

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await expectRound(a, `${RUN}ok`, /xác nhận/i);
});

test("B Trả lại có lý do ⇒ A (nhân viên) thấy trả lại + lý do", async ({ browser }) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list?source=partner");
  await rowOf(b, `${RUN}tl`).click();
  await claim(b);
  // CR-128 (e): Trả lại / Từ chối nằm trong «Thao tác ▾»; bấm ⇒ ô lý do (`data-approval=reason`) ⇒ xác nhận
  await b.getByTestId("head-actions-menu").click();
  await b.locator("[data-approval=return]").click();
  const form = b.locator("[data-approval=reason]");
  await form.getByRole("textbox").fill("Sửa điều 4 về thời hạn thanh toán");
  await form.getByRole("button", { name: "Trả lại" }).click();

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await expectRound(a, `${RUN}tl`, /trả lại/i);
  await expect(a.getByText("Sửa điều 4 về thời hạn thanh toán").first()).toBeVisible();
});

test("B Từ chối có lý do ⇒ A (nhân viên) thấy từ chối + lý do", async ({ browser }) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list?source=partner");
  await rowOf(b, `${RUN}tc`).click();
  await claim(b);
  await b.getByTestId("head-actions-menu").click();
  await b.locator("[data-approval=reject]").click();
  const form = b.locator("[data-approval=reason]");
  await form.getByRole("textbox").fill("Giá cao hơn thoả thuận");
  await form.getByRole("button", { name: "Từ chối" }).click();

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await expectRound(a, `${RUN}tc`, /từ chối/i);
  await expect(a.getByText("Giá cao hơn thoả thuận").first()).toBeVisible();
});
