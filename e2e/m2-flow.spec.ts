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
  openSystemEntry,
  openWorkflowProcessFromNav,
  resetFixture,
  toast,
  withOwner,
} from "./support/helpers";

test.beforeAll(() => {
  resetFixture();
});

const saved = (page: Page, path: string, method: string) =>
  page.waitForResponse((r) => r.url().includes(path) && r.request().method() === method);
const save = (page: Page) => page.getByRole("button", { name: "Lưu", exact: true });

test("ADM-FR-50 · M2-AC09 · admin seed → Secrets (thêm) → Workflows (tạo, 'Chưa gắn') → Commands (thiếu map bị chặn, map đủ lưu) → Features (cấp cho acme) → xoá workflow bị chặn kèm danh sách; secret không rò", async ({
  page,
}) => {
  await loginAdmin(page);
  const traffic = collectTraffic(page);

  // 1. Secrets
  await openSystemEntry(page, /Secrets/); // CR-121 c22
  await expect(page.getByRole("heading", { level: 1, name: "Secrets" })).toBeVisible();
  await page.getByRole("button", { name: "+ Thêm secret" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Tên", { exact: true }).fill("DIFY_E2E_KEY");
  await drawer.getByLabel("Giá trị", { exact: true }).fill(LEAK_1);
  const secretSaved = saved(page, "/admin/secrets", "POST");
  await drawer.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await secretSaved).status()).toBe(201);
  await expect(toast(page, "Đã thêm DIFY_E2E_KEY")).toBeVisible();

  // 2. Workflows: tạo workflow chưa gắn
  await openWorkflowProcessFromNav(page); // CR-121 c16: Công cụ AI
  await page.getByRole("link", { name: "Tạo workflow" }).click();
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
  const wfId = page.url().split("/").pop() ?? "";
  await page.goto("/ai-tools?kind=workflow"); // tải mới: danh sách công cụ có thể còn bản cache trước khi tạo
  await page.getByRole("searchbox", { name: "Tìm công cụ" }).fill("translate");
  const wfRow = page.getByRole("row", { name: /translate[ -]e2e/i });
  await expect(wfRow).toContainText("Chưa công ty nào dùng");

  // 3. Commands: thiếu map target_lang bị chặn → map đủ lưu
  await openWorkflowProcessFromNav(page);
  await page.getByRole("link", { name: "Tạo lệnh" }).click();
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
  // CR-121: Features không còn mục sidebar; trang /features vào bằng URL.
  await page.goto("/features");
  await expect(page.getByRole("heading", { level: 1, name: "Features" })).toBeVisible();
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

  // 5. Xoá translate-e2e bị chặn (API; CR-121 c16 đã gỡ danh sách /workflows cùng nút Xoá): 409 liệt kê command /dich-e2e
  const blocked = await page.request.delete(`/admin/workflows/${wfId}`);
  expect(blocked.status()).toBe(409);
  expect(JSON.stringify(await blocked.json())).toContain("dich-e2e");
  // Dữ liệu cuối + không rò secret
  const [ent] = await withOwner(
    (sql) => sql`select count(*)::int as n from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id join admin.tenants t on t.id = e.tenant_id
      where f.key = 'e2e-pack' and t.key = 'acme' and e.revoked_at is null`,
  );
  expect(ent?.n).toBe(1);
  expect(await leaksOnPage(page, traffic, leakForms(LEAK_1))).toEqual([]);
});
