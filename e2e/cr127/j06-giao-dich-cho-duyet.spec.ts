// CR-127 · J06 · U6 · giao dịch từ Sản phẩm & Giá gắn mốc HĐ (stack journey thật, công ty `e2e-sub-<hậu tố>` có quy trình «Giám đốc duyệt» từ sơ đồ trống): đối tác có HĐ mở ⇒ BẮT BUỘC chọn mốc hoặc
// «Không theo hợp đồng» (+ lý do); gắn mốc cần bằng chứng. Tiền đề: HĐ DONE (nhân viên tải + Gửi duyệt) của đối tác «Công ty TNHH E2E-JOURNEY Bên Bán», mốc Giao lập bằng API.
import { pickOption } from "../_kit/ui";
import { test } from "../journey-approval/_test";
import { doneContractWithMilestones, envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j06);
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await doneContractWithMilestones(browser, E, `j06-${Date.now().toString(36)}`);
});

const fillDeal = async (page: import("@playwright/test").Page) => {
  await page.goto("/contracts/c/new?type=deal");
  const supplier = page.getByLabel(/Nhà cung cấp/).first();
  const opt = page.getByTestId("partner-option").filter({ hasText: "E2E-JOURNEY Bên Bán" }).first();
  // tra đối tác là bất đồng bộ (debounce + mạng): kết quả chưa về/bị bỏ khi tải nặng ⇒ gõ lại cả ô rồi bấm gợi ý
  await expect(async () => {
    await supplier.fill("");
    await supplier.fill("E2E-JOURNEY Bên Bán");
    await opt.click({ timeout: 6000 });
  }).toPass({ timeout: 40_000 });
  await page.getByLabel(/Tên giao dịch/).fill("Bán thùng phi 200L");
  await page.getByLabel(/Ngày giao dịch/).fill("2026-11-11");
  await pickOption(page.locator("#cf-source"), "invoice");
};

test("Có HĐ mở ⇒ phải chọn mốc hoặc Không theo hợp đồng; thiếu lý do bị chặn", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await fillDeal(page);
  await expect(page.getByTestId("deal-link")).toBeVisible();
  await page.getByRole("button", { name: /Lưu/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "chọn một mốc" }).first()).toBeVisible();
  await page.getByTestId("deal-link-none").click();
  await page.getByRole("button", { name: /Lưu/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "lý do" }).first()).toBeVisible();
});

test("Chọn mốc ⇒ hiện ô Bằng chứng; thiếu chữ ký/tệp bị chặn; đủ ⇒ ghi vào mốc", async ({
  page,
}) => {
  await loginCw(page, E, U.employee);
  await fillDeal(page);
  await page.getByTestId("deal-link-milestone").first().click();
  await expect(page.getByTestId("deal-link-evidence")).toBeVisible();
  await page.getByRole("button", { name: /Lưu/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ý kiến" }).first()).toBeVisible();
  const ev = page.getByTestId("deal-link-evidence");
  await ev.getByLabel(/Ý kiến/).fill("Giao 400 thùng, khách nhận đủ (email 21/11).");
  await ev.locator("input[type=file]").setInputFiles({
    name: "email.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 email"),
  });
  await expect(ev.getByText("email.pdf")).toBeVisible(); // tệp tải xong mới bấm Lưu
  await page.getByRole("button", { name: /Lưu/ }).click();
  await expect(page.getByTestId("deal-linked")).toContainText(/ghi nhận|kiểm duyệt/);
});

test("Không theo hợp đồng + lý do ⇒ lưu giao dịch lẻ", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await fillDeal(page);
  await page.getByTestId("deal-link-none").click();
  await page.getByLabel(/Lý do không theo hợp đồng/).fill("Khách mua lẻ ngoài hợp đồng khung.");
  await page.getByRole("button", { name: /Lưu/ }).click();
  await expect(page).toHaveURL(/\/contracts\/c\//);
});
