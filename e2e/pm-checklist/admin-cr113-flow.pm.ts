// pm-checklist-e2e · CR-113 bước 6 · ai-admin › Quy trình (thư viện) › mẫu "Duyệt HĐ 2 cấp (mẫu CR-113)": hộp "Luật duyệt" nêu hai luật.
import { expect, test } from "@playwright/test";
import { loginAdmin } from "../support/helpers";

test("CR-113 · 6 · ai-admin: mẫu Duyệt HĐ 2 cấp có hộp Luật duyệt (2 luật) trong trình sửa Form", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByRole("link", { name: "Quy trình nghiệp vụ", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Thư viện" })).toBeVisible();
  await page.getByRole("tab", { name: "Thư viện" }).click();
  await page
    .getByText(/Duyệt HĐ 2 cấp/)
    .first()
    .click();
  await page
    .getByRole("group", { name: "Cách xem" })
    .getByRole("button", { name: "Danh sách" })
    .click();
  const box = page.getByTestId("flow-form-rules");
  await expect(box).toContainText("Luật duyệt");
  await expect(box.getByRole("listitem")).toHaveCount(2);
});
