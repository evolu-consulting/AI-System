// ADM-FR-50, ADM-FR-10, ADM-FR-20, ADM-FR-22, ADM-FR-31 · e2e luồng nghiệm thu M2 (test-plan E-M; M2-AC09).
// Secrets → Workflows (Chưa gắn) → Commands (chặn thiếu map, map đủ lưu) → Features (cấp cho tenant) → xoá workflow bị chặn.
// Mỗi lần chuyển route bọc expect(page).toHaveURL / waitForResponse trước khi thao tác tiếp (không race điều hướng).
import { expect, type Page, test } from "@playwright/test";
import {
  collectTraffic,
  LEAK_1,
  leakForms,
  leaksOnPage,
  loginAdmin,
  resetFixture,
  toast,
  withOwner,
} from "./support/helpers";

test.beforeAll(() => {
  resetFixture();
});

const goto = async (page: Page, link: string, url: RegExp, heading: string) => {
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: link, exact: true })
    .click();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
};
const saved = (page: Page, path: string, method: string) =>
  page.waitForResponse((r) => r.url().includes(path) && r.request().method() === method);
const save = (page: Page) => page.getByRole("button", { name: "Lưu", exact: true });

test("ADM-FR-50 · M2-AC09 · admin seed → Secrets (thêm) → Workflows (tạo, 'Chưa gắn') → Commands (thiếu map bị chặn, map đủ lưu) → Features (cấp cho acme) → xoá workflow bị chặn kèm danh sách; secret không rò", async ({
  page,
}) => {
  await loginAdmin(page);
  const traffic = collectTraffic(page);

  // 1. Secrets
  await goto(page, "Secrets", /\/secrets/, "Secrets");
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Tên", { exact: true }).fill("DIFY_E2E_KEY");
  await drawer.getByLabel("Giá trị", { exact: true }).fill(LEAK_1);
  const secretSaved = saved(page, "/admin/secrets", "POST");
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await secretSaved).status()).toBe(201);
  await expect(toast(page, "Đã thêm DIFY_E2E_KEY")).toBeVisible();

  // 2. Workflows: tạo workflow chưa gắn
  await goto(page, "Workflows", /\/workflows/, "Workflows");
  await page.getByRole("link", { name: "+ Khai báo workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/new$/);
  await page.getByRole("textbox", { name: "Key", exact: true }).fill("translate-e2e");
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Translate e2e");
  await page.getByRole("combobox", { name: "Secret" }).click();
  await page.getByRole("option", { name: /DIFY_E2E_KEY/ }).click();
  await page
    .getByRole("textbox", { name: "Base URL", exact: true })
    .fill("https://dify.example.com/v1");
  await page
    .getByRole("textbox", { name: "Mô tả", exact: true })
    .fill("Dịch văn bản sang ngôn ngữ khác theo yêu cầu");
  await page.getByRole("textbox", { name: "Output field", exact: true }).fill("text");
  for (const [i, name] of ["source_text", "target_lang"].entries()) {
    await page.getByRole("button", { name: "+ Thêm tham số" }).click();
    await page.getByRole("textbox", { name: `Tên tham số ${i + 1}` }).fill(name);
    await page.getByRole("checkbox", { name: `Bắt buộc ${i + 1}` }).check();
    await page.getByRole("textbox", { name: `Mô tả tham số ${i + 1}` }).fill(`Tham số ${name}`);
  }
  const wfSaved = saved(page, "/admin/workflows", "POST");
  await save(page).click();
  expect((await wfSaved).status()).toBe(201);
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  await goto(page, "Workflows", /\/workflows$/, "Workflows");
  const wfRow = page
    .getByRole("table", { name: "Workflows" })
    .getByRole("row")
    .filter({ hasText: /translate-e2e/ });
  await expect(wfRow).toContainText("Chưa gắn");

  // 3. Commands: thiếu map target_lang bị chặn → map đủ lưu
  await goto(page, "Commands", /\/commands/, "Commands");
  await page.getByRole("link", { name: "+ Tạo command" }).click();
  await expect(page).toHaveURL(/\/commands\/new$/);
  await page.getByRole("textbox", { name: "Tên command" }).fill("dich-e2e");
  await page.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Dịch văn bản (e2e)");
  await page.getByRole("combobox", { name: "Workflow", exact: true }).click();
  await page.getByRole("option", { name: /translate-e2e/ }).click();
  await page.getByRole("combobox", { name: "Nguồn của source_text" }).click();
  await page.getByRole("option", { name: "Đoạn bôi đen", exact: true }).click();
  await save(page).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "thiếu input bắt buộc: target_lang" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Nguồn của target_lang" }).click();
  await page.getByRole("option", { name: "Giá trị cố định", exact: true }).click();
  await page.getByRole("textbox", { name: "Giá trị của target_lang" }).fill("vi");
  const cmdSaved = saved(page, "/admin/commands", "POST");
  await save(page).click();
  expect((await cmdSaved).status()).toBe(201);
  await expect(page).toHaveURL(/\/commands\/[0-9a-f-]{36}$/);

  // 4. Features: tạo feature chứa command, cấp cho acme
  await goto(page, "Features", /\/features/, "Features");
  await page.getByRole("link", { name: "+ Tạo feature" }).click();
  await expect(page).toHaveURL(/\/features\/new$/);
  await page.getByRole("textbox", { name: "Key", exact: true }).fill("e2e-pack");
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Gói E2E");
  const featSaved = saved(page, "/admin/features", "POST");
  await save(page).click();
  expect((await featSaved).status()).toBe(201);
  await expect(page).toHaveURL(/\/features\/[0-9a-f-]{36}$/);
  await page.getByRole("tab", { name: "Commands", exact: true }).click();
  await page.getByRole("combobox", { name: "Thêm command" }).click();
  await page.getByRole("option", { name: /dich-e2e/ }).click();
  const featPatched = saved(page, "/admin/features/", "PATCH");
  await save(page).click();
  expect((await featPatched).status()).toBe(200);
  await page.getByRole("tab", { name: "Tenant", exact: true }).click();
  await page.getByRole("button", { name: "+ Cấp cho tenant" }).click();
  await page.getByRole("option", { name: /acme/ }).click();
  await expect(toast(page, "Đã cấp Gói E2E cho acme")).toBeVisible();

  // 5. Quay lại Workflows: xoá translate-e2e bị chặn, liệt kê command
  await goto(page, "Workflows", /\/workflows$/, "Workflows");
  await wfRow.getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Xoá", exact: true }).click();
  const blocked = page.getByRole("alertdialog", { name: /Không xoá được translate-e2e/ });
  await expect(blocked).toBeVisible();
  await expect(blocked.getByRole("link", { name: "/dich-e2e" })).toBeVisible();
  await blocked.getByRole("button", { name: "Đóng" }).click();

  // Dữ liệu cuối + không rò secret
  const [ent] = await withOwner(
    (sql) => sql`select count(*)::int as n from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id join admin.tenants t on t.id = e.tenant_id
      where f.key = 'e2e-pack' and t.key = 'acme' and e.revoked_at is null`,
  );
  expect(ent?.n).toBe(1);
  expect(await leaksOnPage(page, traffic, leakForms(LEAK_1))).toEqual([]);
});
