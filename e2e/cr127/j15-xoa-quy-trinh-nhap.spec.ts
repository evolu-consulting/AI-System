// CR-127 · J15 · Z7 · xoá quy trình NHÁP (stack journey thật, công ty `e2e-s2-<hậu tố>` đã có quy trình «trưởng phòng» ĐÃ ÁP DỤNG từ `_cr127-stack.ts`): quản trị nền tảng
// tạo quy trình trống cho công ty ⇒ ở trang Quy trình thấy nút «Xoá» ⇒ hộp xác nhận «Xoá quy trình» ⇒ toast + dòng biến mất; quy trình đã áp dụng KHÔNG có «Xoá».
import { apiLogin, createBlankFlow } from "../_kit/api";
import { loginPlatformAdminUi } from "../_kit/ui";
import { test } from "../journey-approval/_test";
import { API, envOf, expect, HUB, SPEC_TENANT, tenantIdOf } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j03);
const NAME = `Quy trình nháp j15 ${Date.now().toString(36)}`;

test("Quy trình nháp: có «Xoá» ⇒ xác nhận ⇒ biến mất; quy trình đã áp dụng không có «Xoá»", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const admin = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  await createBlankFlow(HUB, admin, await tenantIdOf(E), NAME);

  await loginPlatformAdminUi(page, E.admin, E.adminUser, E.adminPw);
  await page.goto(`${E.admin}/processes`);
  const rows = page.getByTestId("company-flow-row");
  const draft = rows.filter({ hasText: NAME });
  await expect(draft).toHaveCount(1, { timeout: 30_000 });
  // đã áp dụng (do `_cr127-stack`) ⇒ không có nút «Xoá»
  const applied = rows
    .filter({ hasText: "Duyệt hợp đồng (trưởng phòng)" })
    .filter({ hasText: E.tenantName });
  await expect(applied).toHaveCount(1);
  await expect(applied.getByTestId("delete-draft-flow")).toHaveCount(0);

  await draft.getByRole("button", { name: "Xoá", exact: true }).click();
  const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dlg).toContainText(NAME);
  await dlg.getByRole("button", { name: "Xoá quy trình" }).click();
  await expect(page.getByText("Đã xoá quy trình")).toBeVisible();
  await expect(draft).toHaveCount(0);
  await expect(applied).toHaveCount(1);
});
