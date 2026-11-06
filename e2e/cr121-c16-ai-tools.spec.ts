// CR-121 R6 · c16 · e2e hành trình (D5) Công cụ AI: platform_admin tìm một công cụ Dify TỰ TẠO (hậu tố duy nhất, không dùng dữ liệu mẫu),
// mở ngăn chi tiết, bật cho một công ty TỰ TẠO (không seed bật sẵn), tắt (hỏi xác nhận, huỷ giữ nguyên), rồi `?tab=workflow-tools` cũ
// chuyển tới /ai-tools. admin-api + DB e2e THẬT. KHÔNG chạy trong lát (luật 5d) — điều phối chạy một lần cuối đợt.
import { expect, test } from "@playwright/test";
import { apiLogin, createIsolatedTenant } from "./_kit/api";
import { uniqueSuffix } from "./_kit/unique";
import { loginAdmin, seedAdmin, withOwner } from "./support/helpers";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.config đặt)
const ADMIN = process.env.E2E_API_URL ?? "http://localhost:3001";
const run = uniqueSuffix();
const TOOL = {
  id: crypto.randomUUID(),
  key: `e2e-c16-${run}`.slice(0, 32),
  name: `Công cụ thử c16 ${run}`,
};
let company = { id: "", name: "" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const s = await apiLogin({
    base: ADMIN,
    tenantKey: "platform",
    username: seedAdmin().username,
    password: seedAdmin().password,
  });
  const t = await createIsolatedTenant(ADMIN, s, "c16");
  company = { id: (t.json as { id: string }).id, name: t.name };
  await withOwner(async (sql) => {
    const [sec] = await sql<
      { id: string }[]
    >`select id from admin.secrets order by created_at limit 1`;
    if (!sec) throw new Error("fixture: cần ít nhất một secret để tạo workflow thử");
    await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
      values (${TOOL.id}, ${TOOL.key}, ${TOOL.name}, 'Workflow e2e thử nghiệm của lát c16.', 'workflow', 'http://127.0.0.1:9/v1', ${sec.id})`;
  });
});

test.afterAll(async () => {
  await withOwner(async (sql) => {
    await sql`delete from admin.workflows where id = ${TOOL.id}`; // cascade xoá công tắc
  });
});

test("CR-121 · c16 · tìm công cụ → ngăn chi tiết → bật cho công ty → tải lại vẫn bật → tắt có xác nhận", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto("/ai-tools");
  await expect(page.getByRole("heading", { name: "Công cụ AI" })).toBeVisible();
  // Không còn 3 mục nav rời + tab công ty cũ: chỉ một nơi bật/tắt.
  await page.getByRole("searchbox", { name: "Tìm công cụ" }).fill(TOOL.name);
  const row = page.getByRole("row", { name: new RegExp(TOOL.name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Chưa công ty nào dùng");

  // Chip "Chưa dùng" giữ công cụ chưa công ty nào dùng.
  await page.getByRole("button", { name: /^Chưa dùng/ }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: /^Chưa dùng/ }).click();

  await row.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(TOOL.name);
  await expect(drawer.getByRole("heading", { name: "Công ty dùng" })).toBeVisible();
  const sw = drawer.getByRole("switch", { name: `Bật ${TOOL.name} cho ${company.name}` });
  await expect(sw).not.toBeChecked();

  const put = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/workflow-tools/${TOOL.id}`),
  );
  await sw.click();
  expect((await put).status()).toBe(200);
  await expect(page.getByText(`Đã bật ${TOOL.name} cho ${company.name}`)).toBeVisible();
  await expect(sw).toBeChecked();

  await page.reload();
  const swAfter = page
    .getByRole("dialog")
    .getByRole("switch", { name: `Bật ${TOOL.name} cho ${company.name}` });
  await expect(swAfter).toBeChecked();
  await expect(page.getByRole("dialog")).toContainText(/1 \/ \d+ công ty đang bật/);

  await swAfter.click();
  const dlg = page.getByRole("alertdialog", { name: `Tắt ${TOOL.name} cho ${company.name}?` });
  await expect(dlg).toContainText(
    "Lượt chạy đang chờ gọi công cụ này sẽ dừng ở “Cần người quyết”.",
  );
  await dlg.getByRole("button", { name: "Huỷ" }).click();
  await expect(swAfter).toBeChecked();

  await swAfter.click();
  const del = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes(`/workflow-tools/${TOOL.id}`),
  );
  await page
    .getByRole("alertdialog", { name: `Tắt ${TOOL.name} cho ${company.name}?` })
    .getByRole("button", { name: "Tắt công cụ" })
    .click();
  expect((await del).status()).toBe(200);
  await expect(swAfter).not.toBeChecked();
});

test("CR-121 · c16 · ?tab=workflow-tools cũ của trang công ty → /ai-tools kèm thông báo; tab đã gỡ", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/tenants/${company.id}?tab=workflow-tools`);
  await expect(page).toHaveURL(/\/ai-tools\?.*notice=company-tools/);
  await expect(page.getByText("Bật/tắt Dify theo công ty nằm ở Công cụ AI.")).toBeVisible();
  await page.goto(`/tenants/${company.id}`);
  await expect(page.getByRole("tab", { name: "Tool quy trình" })).toHaveCount(0);
});
