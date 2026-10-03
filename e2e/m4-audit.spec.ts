// ADM-FR-51 · ADM-FR-52 · M4-R12 · R13 · BR-04 · Q8 · M4-AC07 · AC08 · AC12 · e2e Nhật ký (test-plan-ab-e2e E14–E20).
// audit_log tích luỹ (append-only, không xoá): lấy dòng mới nhất (`.first()`) hoặc lọc theo tên mốc ca.
import { expect, test } from "@playwright/test";
import { versionOf } from "./support/conflict";
import {
  apiAsAdmin,
  collectTraffic,
  ID,
  LEAK_2,
  leakForms,
  leaksOnPage,
  loginAdmin,
  loginAs,
  loginUI,
  PW,
  resetFixture,
  seedAuditRows,
  toast,
  withOwner,
} from "./support/helpers";
import {
  ACME,
  auditItems,
  auditRow,
  auditSearch,
  KT,
  openAudit,
  openDetail,
} from "./support/m4-ab";

test.beforeEach(() => {
  resetFixture();
});

type Api = Awaited<ReturnType<typeof apiAsAdmin>>;
const DICH = `/admin/commands/${ID.command.dich}`;
const SENTENCE = "admin đã sửa command /dich";

async function patchDich(api: Api, body: Record<string, unknown>) {
  const version = await versionOf("commands", ID.command.dich);
  const r = await api.patch(DICH, { version, ...body });
  expect(r.status()).toBe(200);
}

test("ADM-FR-51 · E14 · admin sửa /dich → /audit có 'admin đã sửa command /dich'; 'Xem thay đổi' mở dialog + table 'Thay đổi' có 'đã đổi', URL /audit/{id}; 'Đóng' → /audit", async ({
  page,
  request,
}) => {
  await patchDich(await apiAsAdmin(request), { description: { vi: "Mô tả E14" } });
  await loginAdmin(page);
  await openAudit(page);
  await expect(auditRow(page, SENTENCE)).toBeVisible();
  const sheet = await openDetail(page, SENTENCE);
  await expect(sheet.getByRole("table", { name: "Thay đổi" })).toContainText("đã đổi");
  await expect(page).toHaveURL(/\/audit\/[0-9a-f-]{36}$/);
  await sheet.getByRole("button", { name: "Đóng" }).click();
  await expect(page).toHaveURL(/\/audit(\?[^/]*)?$/);
});

test("ADM-FR-52 · M4-AC08 · E15 · /dich v42→v43: 'Khôi phục bản trước' → alertdialog 'Khôi phục /dich về trạng thái trước v43?' → 'Khôi phục' (POST 200) → toast 'Đã khôi phục /dich · v44'", async ({
  page,
  request,
}) => {
  await withOwner(async (sql) => {
    await sql`update admin.commands set version = 42 where id = ${ID.command.dich}`;
  });
  await patchDich(await apiAsAdmin(request), { description: { vi: "B" } });
  await loginAdmin(page);
  await openAudit(page);
  await openDetail(page, SENTENCE);
  await page.getByRole("button", { name: "Khôi phục bản trước" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Khôi phục /dich về trạng thái trước v43?",
  });
  await expect(confirm).toBeVisible();
  const done = page.waitForResponse(
    (r) => /\/admin\/audit\/[^/]+\/restore$/.test(r.url()) && r.request().method() === "POST",
  );
  await confirm.getByRole("button", { name: "Khôi phục", exact: true }).click();
  expect((await done).status()).toBe(200);
  await expect(toast(page, "Đã khôi phục /dich · v44")).toBeVisible();
});

test("M4-R13 · E16 · tên 'dich' đã bị command khác dùng → toast 'Không khôi phục được: /dich đã được dùng bởi command khác'", async ({
  page,
  request,
}) => {
  const api = await apiAsAdmin(request);
  await patchDich(api, { name: "dich2" });
  const created = await api.post("/admin/commands", {
    name: "dich",
    description: { vi: "Command mới dùng tên dich" },
    workflow_id: ID.workflow.reportTax,
    output: { field: "text", render: "text" },
    enabled: false,
    feature_ids: [KT],
  });
  expect(created.status()).toBe(201);
  await loginAdmin(page);
  await openAudit(page);
  await openDetail(page, /đã sửa command/);
  await page.getByRole("button", { name: "Khôi phục bản trước" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: /^Khôi phục .+ về trạng thái trước v\d+\?$/,
  });
  const done = page.waitForResponse(
    (r) => /\/admin\/audit\/[^/]+\/restore$/.test(r.url()) && r.request().method() === "POST",
  );
  await confirm.getByRole("button", { name: "Khôi phục", exact: true }).click();
  expect((await done).status()).toBe(409);
  await expect(
    toast(page, "Không khôi phục được: /dich đã được dùng bởi command khác"),
  ).toBeVisible();
});

test("ADM-FR-51 · BR-04 · E17 · thay giá trị secret → chi tiết 'Giá trị: đã thay đổi', trang/mạng/console không chứa LEAK_2", async ({
  page,
  request,
}) => {
  const api = await apiAsAdmin(request);
  expect((await api.put("/admin/secrets/DIFY_TRANSLATE_KEY", { value: LEAK_2 })).status()).toBe(
    200,
  );
  await loginAdmin(page);
  const traffic = collectTraffic(page);
  await openAudit(page);
  const sheet = await openDetail(page, /đã thay giá trị secret/);
  await expect(sheet).toContainText("Giá trị: đã thay đổi");
  expect(await leaksOnPage(page, traffic, leakForms(LEAK_2))).toEqual([]);
});

test("ADM-FR-51 · Q8 · M4-AC07 · E18 · binh /audit: dòng acme, không combobox Tenant/'Toàn hệ thống', không 'Khôi phục bản trước'; /audit/{id globex} → 'Không tìm thấy'", async ({
  page,
}) => {
  const globexId = await withOwner(async (sql) => {
    await seedAuditRows(sql, 1, { prefix: "e18-acme-", tenantId: ACME });
    await seedAuditRows(sql, 1, { prefix: "e18-sys-", tenantId: null });
    await seedAuditRows(sql, 1, {
      prefix: "e18-globex-",
      tenantId: "01900000-0000-7000-8000-000000000002",
    });
    const [r] =
      await sql`select id from admin.audit_log where entity_name = 'e18-globex-01' limit 1`;
    return (r as unknown as { id: string }).id;
  });
  await loginAs(page, "acme", "binh");
  await openAudit(page);
  await expect(page.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
  await expect(auditRow(page, "e18-acme-01")).toBeVisible();
  await expect(auditRow(page, "e18-globex-01")).toHaveCount(0);
  await expect(page.getByText("Toàn hệ thống")).toHaveCount(0);
  await openDetail(page, "e18-acme-01");
  await expect(page.getByRole("button", { name: "Khôi phục bản trước" })).toHaveCount(0);
  await page.goto(`/audit/${globexId}`);
  await expect(page.getByText("Không tìm thấy")).toBeVisible();
});

test("ADM-FR-51 · M4-R12 · E19 · 55 dòng m4-page-* → tìm 'm4-page' → 50 dòng; 'Tải thêm' → nhiều hơn 50", async ({
  page,
}) => {
  await withOwner((sql) => seedAuditRows(sql, 55));
  await loginAdmin(page);
  await openAudit(page);
  await auditSearch(page).fill("m4-page");
  await expect(auditItems(page)).toHaveCount(50);
  await page.getByRole("button", { name: "Tải thêm" }).click();
  await expect.poll(() => auditItems(page).count()).toBeGreaterThan(50);
});

test("M4-AC12 · E20 · member an vào /audit và /usage → bị chuyển về /member", async ({ page }) => {
  await loginUI(page, "acme", "an", PW);
  await expect(page).toHaveURL(/\/member$/);
  await page.goto("/audit");
  await expect(page).toHaveURL(/\/member$/);
  await page.goto("/usage");
  await expect(page).toHaveURL(/\/member$/);
});
