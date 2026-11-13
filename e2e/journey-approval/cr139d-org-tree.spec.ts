// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-139d · HÀNH TRÌNH «Sơ đồ tổ chức dạng cây» trên công ty mẫu `demo` (bun run demo:org):
// nhân viên (cuong.le) xem cây + mở thành viên, KHÔNG có «Chỉnh sơ đồ»; quản trị công ty (JA_ORG_ADMIN, mặc định owner) bấm «Chỉnh sơ đồ»
// ⇒ sang ai-admin, thêm phòng con thuộc phòng có sẵn, đặt trưởng phòng ⇒ Sổ Hợp Tác hiện phòng mới trong cây. Không chạy trong lát; chạy MỘT lần cuối đợt.
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
  await expect(page.getByTestId("org-tree")).toContainText("Phòng Kinh doanh");
  await page.getByTestId("org-members-toggle").first().click();
  await expect(page.getByTestId("org-members").first()).toBeVisible();
  await expect(page.getByTestId("org-edit")).toHaveCount(0);
});

test("quản trị chỉnh sơ đồ ở admin ⇒ cây ở Sổ Hợp Tác đổi theo; vòng cha–con bị chặn", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await login(page, ADMIN);
  await page.goto(`${CW}/contracts/org`);
  await page.getByTestId("org-edit").click();
  await expect(page.getByTestId("org-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Tên phòng mới").fill(NEW_DEPT);
  await page.getByLabel("Thuộc phòng của phòng mới").selectOption({ label: "Phòng Kinh doanh" });
  await page.getByRole("button", { name: "Thêm phòng" }).click();
  await expect(page.getByRole("heading", { name: NEW_DEPT })).toBeVisible();
  // Phòng cha không được chọn chính con của nó: «Phòng Kinh doanh» không có phòng mới trong danh sách «Thuộc phòng».
  const parentOpts = page.getByLabel("Thuộc phòng · Phòng Kinh doanh").locator("option");
  await expect(parentOpts.filter({ hasText: NEW_DEPT })).toHaveCount(0);
  await page.goto(`${CW}/contracts/org`);
  await expect(page.getByTestId("org-tree")).toContainText(NEW_DEPT);
});
