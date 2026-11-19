// CR-187 BR-187-1 · «Đổi mật khẩu» mở hộp thoại ngay trong Sổ Hợp Tác (không mở tab quản trị): sai mật khẩu hiện tại ⇒ lỗi trong hộp;
// nhập đúng ⇒ MỘT POST /auth/change-password nhánh current_password ⇒ «Đã đổi mật khẩu». Backend giả `page.route`; chạy cuối đợt.
import { expect, type Route, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test("đổi mật khẩu tại chỗ: sai hiện tại ⇒ lỗi trong hộp, rồi đúng ⇒ đã đổi", async ({ page }) => {
  await installV2f(page, { role: "editor" });
  const posts: unknown[] = [];
  await page.route("**/auth/change-password", (r) => {
    posts.push(r.request().postDataJSON());
    return posts.length === 1
      ? json(r, 400, { code: "INVALID_CURRENT_PASSWORD", message: "x" })
      : r.fulfill({ status: 204 });
  });
  await page.goto("/contracts/partners");
  await page.getByRole("button", { name: "Tài khoản" }).first().click();
  await page.getByTestId("account-change-password").click();
  const box = page.getByTestId("change-password-dialog");
  await expect(box).toBeVisible();

  await box.locator('input[name="current"]').fill("MatKhauCu-123");
  await box.locator('input[name="next"]').fill("MatKhauMoi-456!");
  await box.locator('input[name="confirm"]').fill("MatKhauMoi-456!");
  await expect(box.getByText(/Độ mạnh/)).toBeVisible();
  await box.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(box.getByRole("alert")).toHaveText("Mật khẩu hiện tại không đúng.");

  await box.locator('input[name="current"]').fill("MatKhauDung-789");
  await box.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(box).toBeHidden();
  await expect(page.getByText("Đã đổi mật khẩu")).toBeVisible();
  expect(posts.at(-1)).toEqual({
    current_password: "MatKhauDung-789",
    new_password: "MatKhauMoi-456!",
  });
});
