// ADM-FR-36 · M3-R13 · e2e tab "Quyền hiệu lực" của drawer sửa user (test-plan E-AUT; tên file đổi từ users-access để mẫu `users`
// của FE4a không khớp nhầm). Dùng chung AccessExplainer, CHỈ ĐỌC. Nhãn nguyên văn plan-frontend §5.
import { expect, type Page, test } from "@playwright/test";
import { loginAs, resetFixture, rowOf } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  resetFixture();
});

const openDrawer = async (page: Page, username: string) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/users");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
  await rowOf(page, "Users", username).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Sửa", exact: true }).click();
  return page.getByRole("dialog", { name: new RegExp(`${username} · `) });
};

test("ADM-FR-36 · M3-R13 · lan: tab 'Quyền hiệu lực' chỉ có khi SỬA (dialog 'Tạo user' không có tab); nội dung chỉ đọc: 'Thấy /kiemtra-hoadon', KHÔNG có nút 'Cấp Kế toán cho group…'; Agent (X1 F5, vắng PUBLIC_HUB_URL) 'Chưa cấu hình địa chỉ Hub (PUBLIC_HUB_URL).'", async ({
  page,
}) => {
  const drawer = await openDrawer(page, "lan");
  await drawer.getByRole("tab", { name: "Quyền hiệu lực" }).click();
  await expect(drawer.getByText("Thấy /kiemtra-hoadon")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Cấp .* cho group…/ })).toHaveCount(0);
  await expect(drawer.getByRole("heading", { level: 3, name: "Agent" })).toBeVisible();
  await expect(drawer.getByText("Chưa cấu hình địa chỉ Hub (PUBLIC_HUB_URL).")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "+ Tạo user" }).click();
  const create = page.getByRole("dialog", { name: "Tạo user" });
  await expect(create.getByRole("tab", { name: "Quyền hiệu lực" })).toHaveCount(0);
});

test("ADM-FR-36 · M3-R13 · link 'Mở Kiểm tra quyền' → /access?tab=check&user=lan&tenant=acme và tab 'Kiểm tra quyền' đang chọn", async ({
  page,
}) => {
  const drawer = await openDrawer(page, "lan");
  await drawer.getByRole("tab", { name: "Quyền hiệu lực" }).click();
  await drawer.getByRole("link", { name: "Mở Kiểm tra quyền" }).click();
  await expect(page).toHaveURL(/\/access\?.*tab=check/);
  await expect(page).toHaveURL(/user=lan/);
  await expect(page).toHaveURL(/tenant=acme/);
  await expect(page.getByRole("tab", { name: "Kiểm tra quyền", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("ADM-FR-36 · M3-R13 · tab chỉ gọi effective-access khi MỞ: 0 request trước khi bấm tab, đúng 1 sau khi bấm", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/effective-access")) calls.push(r.url());
  });
  const drawer = await openDrawer(page, "lan");
  await expect(drawer.getByRole("tab", { name: "Quyền hiệu lực" })).toBeVisible();
  expect(calls).toEqual([]);
  const resp = page.waitForResponse((r) => r.url().includes("/effective-access"));
  await drawer.getByRole("tab", { name: "Quyền hiệu lực" }).click();
  expect((await resp).status()).toBe(200);
  expect(calls).toHaveLength(1);
});

test("ADM-FR-36 · M3-R11 · em (inactive): tab hiện lý do 'Tài khoản này đang bị khoá.'", async ({
  page,
}) => {
  const drawer = await openDrawer(page, "em");
  await drawer.getByRole("tab", { name: "Quyền hiệu lực" }).click();
  await drawer.getByRole("button", { name: /Hiện command không thấy/ }).click();
  await drawer.getByRole("button", { name: "Vì sao không?" }).first().click();
  await expect(drawer.getByText("Tài khoản này đang bị khoá.").first()).toBeVisible();
});
