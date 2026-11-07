// CR-121 D-3 · trình sửa quy trình thư viện: trình dựng điều kiện "Chỉ chạy khi" + chặn khi thiếu phòng ban. Viết sẵn, CHẠY một lần cuối đợt
// (cùng stack thật `playwright.journey.config.ts`: tenant `e2e-approval`, quy trình thư viện "E2E Mua (Kinh doanh)" đã có từ seed journey).
// Dữ liệu riêng: nhân bản quy trình mẫu thành bản nháp tên có hậu tố duy nhất — không sửa bản dùng chung.
import { expect, type Page, test } from "@playwright/test";
import { uniqueSuffix } from "../_kit/unique";
import { loginAdmin, PROC } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const E = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  tenantKey: "e2e-approval",
  tenantName: "E2E Approval Journey",
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
};
const STEP2 = "flow-step-1"; // bước thứ 2 (bước 1 luôn chạy, không có điều kiện)

/** Nhân bản quy trình mẫu → bản nháp riêng, mở Form (nút "Danh sách" ở thanh công cụ). */
async function openOwnDraft(page: Page, name: string): Promise<void> {
  await loginAdmin(page, E);
  await page.goto(`${E.admin}/processes`);
  await page.getByText(PROC.buy, { exact: false }).first().click();
  // Chờ rời danh sách (mỗi dòng có nút "Nhân bản") sang trang chi tiết rồi mới bấm — tránh strict-mode khi chuyển trang chưa xong.
  await expect(page).toHaveURL(/\/processes\/[0-9a-f-]{36}/);
  await expect(page.getByRole("button", { name: "Dùng mẫu này" })).toHaveCount(1);
  await page.getByRole("button", { name: "Dùng mẫu này" }).click();
  await page.getByLabel("Tên quy trình mới").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Dùng mẫu này" }).click();
  await expect(page.getByText("Đã tạo bản nháp từ mẫu")).toBeVisible();
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await expect(page.getByTestId("flow-form")).toBeVisible();
}

/** Chọn trường ở ô "Thêm điều kiện" của bước 2 (Select của shell). */
async function addCond(page: Page, fieldLabel: string): Promise<void> {
  await page.getByTestId(`${STEP2}-add`).click();
  await page.getByRole("option", { name: fieldLabel }).click();
}

test.describe("CR-121 D-3 · trình dựng điều kiện", () => {
  test("thêm Giá trị ≥ 500tr và Loại = Mua, lưu rồi mở lại thấy y nguyên", async ({ page }) => {
    const name = `E2E cond ${uniqueSuffix()}`;
    await openOwnDraft(page, name);
    await expect(page.getByTestId("flow-counter")).toHaveText(/^\d+\/20$/);

    await addCond(page, "Giá trị hợp đồng");
    await page.getByLabel("Số tiền (VND)").fill("500000000");
    await addCond(page, "Loại hợp đồng");
    await expect(page.getByTestId(`${STEP2}-c1-opt-buy`)).toBeChecked();
    await expect(page.getByTestId("flow-ready")).toBeVisible();

    await page.getByRole("button", { name: "Lưu nháp" }).click();
    await expect(page.getByText("Đã lưu").first()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Danh sách", exact: true }).click();
    await expect(page.getByLabel("Số tiền (VND)")).toHaveValue("500000000");
    await expect(page.getByTestId(`${STEP2}-c1-opt-buy`)).toBeChecked();
  });

  test("thiếu phòng ban ⇒ chặn: báo lỗi ở thanh trạng thái, bấm nhảy tới bước, không cho lưu/xuất bản", async ({
    page,
  }) => {
    await openOwnDraft(page, `E2E cond dept ${uniqueSuffix()}`);
    await addCond(page, "Phòng ban người gửi duyệt");

    const issues = page.getByTestId("flow-issues");
    await expect(issues).toContainText("chưa chọn giá trị");
    await expect(page.getByRole("button", { name: "Lưu nháp" })).toBeDisabled();

    await page.getByTestId("flow-issue-jump-1").click();
    await expect(page.getByTestId(STEP2)).toBeInViewport();

    // Chọn một phòng ban ⇒ hết lỗi, lưu được.
    await page.getByTestId(`${STEP2}-c0-row`).getByRole("checkbox").first().check();
    await expect(page.getByTestId("flow-ready")).toBeVisible();
    await expect(page.getByRole("button", { name: "Lưu nháp" })).toBeEnabled();
  });
});
