// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-139d · HÀNH TRÌNH «Sơ đồ tổ chức dạng cây» trên công ty mẫu `demo` (bun run demo:org):
// nhân viên (cuong.le) xem cây + mở thành viên, KHÔNG có «Chỉnh sơ đồ»; quản trị công ty (JA_ORG_ADMIN, mặc định owner) bấm «Chỉnh sơ đồ»
// ⇒ sang ai-admin, «+» thêm phòng con tại chỗ (CR-189) ⇒ Sổ Hợp Tác hiện phòng mới trong cây. Không chạy trong lát; chạy MỘT lần cuối đợt.
import { expect, test } from "@playwright/test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt`);
  return v;
};
const CW = process.env.JA_CW_URL ?? "http://localhost:3300";
const PW = need("DEMO_OWNER_PW");
const ADMIN = process.env.JA_ORG_ADMIN ?? "owner";
const NEW_DEPT = `Phòng thử cây ${Date.now() % 100000}`;

async function login(page: import("@playwright/test").Page, user: string): Promise<void> {
  await page.goto(`${CW}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("demo");
  await page.getByRole("textbox", { name: "Email" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("nhân viên xem cây, mở thành viên, không thấy «Chỉnh sơ đồ»", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await login(page, "cuong.le");
  await page.goto(`${CW}/contracts/org`);
  // CR-142 · sơ đồ cây (xyflow): thẻ phòng có tên + trưởng phòng + số người; bấm thẻ ⇒ hộp thành viên.
  const chart = page.getByTestId("org-tree");
  await expect(chart).toContainText("Phòng Kinh doanh", { timeout: 30_000 });
  await chart.locator("[data-testid^=org-node-]", { hasText: "Phòng Kinh doanh" }).click();
  await expect(page.getByTestId("org-members-dialog")).toBeVisible();
  await expect(page.getByTestId("org-members")).toBeVisible();
  await page.keyboard.press("Escape");
  // tìm ⇒ thẻ phòng được làm nổi
  await page.getByLabel("Tìm phòng ban hoặc người").fill("Kinh doanh");
  await expect(chart.locator("[data-lit=true]").first()).toBeVisible();
  await expect(page.getByTestId("org-edit")).toHaveCount(0);
});

test("quản trị chỉnh sơ đồ ở admin ⇒ cây ở Sổ Hợp Tác đổi theo, vòng cha–con bị chặn", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await login(page, ADMIN);
  await page.goto(`${CW}/contracts/org`);
  await page.getByTestId("org-edit").click();
  await expect(page.getByTestId("org-editor")).toBeVisible({ timeout: 30_000 });
  // CR-189 · sửa trực tiếp trên sơ đồ: «+» dưới thẻ «Phòng Kinh doanh» ⇒ gõ tên phòng con tại chỗ (không còn form «Thêm phòng»).
  const kd = page
    .getByTestId("org-preview")
    .locator("[data-testid^=org-node-]", { hasText: "Phòng Kinh doanh" })
    .first();
  await kd.locator("[data-testid^=org-add-]").first().click();
  await page.locator("[data-testid^=org-add-input-]").fill(NEW_DEPT);
  await page.locator("[data-testid^=org-add-ok-]").click();
  await expect(page.getByTestId("org-preview")).toContainText(NEW_DEPT, { timeout: 30_000 });
  // Phòng cha không được chọn chính con của nó: «Chuyển sang phòng cha khác» của «Phòng Kinh doanh» không liệt kê phòng mới.
  await kd.locator("[data-testid^=org-menu-]").first().click();
  await page.getByTestId("org-menu-move").click();
  await expect(page.getByTestId("org-move-dialog")).not.toContainText(NEW_DEPT);
  await page.keyboard.press("Escape");
  await page.goto(`${CW}/contracts/org`);
  await expect(page.getByTestId("org-tree")).toContainText(NEW_DEPT, { timeout: 30_000 });
});
