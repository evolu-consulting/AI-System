// CR-150 · hành trình 2 công ty (bản đối chiếu với UAT `docs/uat/hop-dong-2-cong-ty.md`): A (nhân viên tạo) → Giám đốc A duyệt → chọn đối tác B (người chọn ≠ người tạo ≠ người thêm đối tác)
// → B nhận (lời mời nối lần đầu) → B duyệt nội bộ → A thấy kết quả; nhánh B Trả lại / Từ chối → A thấy lý do. N2: mỗi bước đúng vai, khác người tạo.
// Dùng cặp d5a → d5b và quy trình dựng bởi `e2e/cr127/_cr127-stack.ts` (đã có Gửi đối tác + Nhận HĐ). VIẾT, CHƯA CHẠY (điều phối chạy cuối đợt trên evotest);
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
const [KA, KB] = SPEC_TENANT.j08;
const [EA, EB] = [envOf(KA), envOf(KB)];
const RUN = Date.now().toString(36);
const rowOf = (page: import("@playwright/test").Page, run: string) =>
  contractRows(page)
    .filter({ hasText: `E2E-JOURNEY-${run}` })
    .first();

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
  await b.locator("[data-approval=approve], [data-approval=pass]").first().click();

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await a.goto("/contracts/list");
  await rowOf(a, `${RUN}ok`).click();
  await expect(a.getByTestId("partner-round").first()).toContainText(/xác nhận/i, {
    timeout: 90_000,
  });
});

test("B Trả lại có lý do ⇒ A (nhân viên) thấy trả lại + lý do", async ({ browser }) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list?source=partner");
  await rowOf(b, `${RUN}tl`).click();
  await b
    .getByPlaceholder(/Lý do|ý kiến/i)
    .first()
    .fill("Sửa điều 4 về thời hạn thanh toán");
  await b.locator("[data-approval=return]").first().click();

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await a.goto("/contracts/list");
  await rowOf(a, `${RUN}tl`).click();
  await expect(a.getByTestId("partner-round").first()).toContainText(/trả lại/i, {
    timeout: 90_000,
  });
  await expect(a.getByText("Sửa điều 4 về thời hạn thanh toán")).toBeVisible();
});

test("B Từ chối có lý do ⇒ A (nhân viên) thấy từ chối + lý do", async ({ browser }) => {
  const b = await newPage(browser);
  await loginCw(b, EB, U.director);
  await b.goto("/contracts/list?source=partner");
  await rowOf(b, `${RUN}tc`).click();
  await b
    .getByPlaceholder(/Lý do|ý kiến/i)
    .first()
    .fill("Giá cao hơn thoả thuận");
  await b.locator("[data-approval=reject]").first().click();

  const a = await newPage(browser);
  await loginCw(a, EA, U.employee);
  await a.goto("/contracts/list");
  await rowOf(a, `${RUN}tc`).click();
  await expect(a.getByTestId("partner-round").first()).toContainText(/từ chối/i, {
    timeout: 90_000,
  });
  await expect(a.getByText("Giá cao hơn thoả thuận")).toBeVisible();
});
