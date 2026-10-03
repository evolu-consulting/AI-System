// ADM-FR-54 · M4-R14 · R15 · M4-AC09 · M4-AC10 · AC-A06 · e2e Import / Export (test-plan-cd-e2e §5.2 E-TR-01…11).
// Nhãn nguyên văn: missing-screens §8, plan-frontend §6. Dữ liệu yaml dựng trong code (tests/acceptance/M4/_transfer-data.ts).
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { baseFile, commandEl, header, padTo, toYaml } from "../tests/acceptance/M4/_transfer-data";
import { versionOf } from "./support/conflict";
import {
  apiAsAdmin,
  collectTraffic,
  ID,
  LEAK_1,
  LEAK_2,
  leakForms,
  leaksOnPage,
  loginAdmin,
  loginAs,
  resetFixture,
  toast,
  withOwner,
} from "./support/helpers";

test.beforeEach(() => {
  resetFixture();
});

const FILE = "config-v39.yaml";
const ENTRIES = ["Workflows", "Commands", "Features", "Tenants", "Groups", "Grants"] as const;
const applyBtn = (page: Page, n = 5) =>
  page.getByRole("button", { name: `Áp dụng ${n} thay đổi`, exact: true });
const anyApply = (page: Page) => page.getByRole("button", { name: /^Áp dụng \d+ thay đổi$/ });
const isImport = (url: string) => /\/admin\/import/.test(url);

async function configVersion(): Promise<number> {
  return withOwner(async (sql) => {
    const [r] = await sql`select config_version::int as n from admin.config_meta`;
    return (r as unknown as { n: number }).n;
  });
}

async function openTransfer(page: Page) {
  await loginAdmin(page);
  await page.getByRole("link", { name: "Import / Export" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import / Export" })).toBeVisible();
}

async function toImport(page: Page) {
  await openTransfer(page);
  await page.getByRole("tab", { name: "Import" }).click();
}

const upload = (page: Page, name: string, content: string | Buffer) =>
  page
    .getByLabel("Chọn file")
    .setInputFiles({ name, mimeType: "application/yaml", buffer: Buffer.from(content) });

/** Tải file export (mọi loại) → nội dung văn bản. */
async function downloadAll(page: Page, n: number) {
  await page.getByRole("tab", { name: "Export" }).click();
  await page.getByRole("checkbox", { name: "Chọn tất cả" }).check();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: `Tải file config-v${n}.yaml`, exact: true }).click();
  const download = await dl;
  const path = await download.path();
  return { download, text: await readFile(path, "utf8") };
}

test("ADM-FR-54 · E-TR-01 · M4-AC09 · tab Export: 6 checkbox có số đếm khớp /export/meta + ghi chú secret", async ({
  page,
  request,
}) => {
  const api = await apiAsAdmin(request);
  const meta = (await (await api.get("/admin/export/meta")).json()) as {
    config_version: number;
    counts: Record<string, number>;
  };
  await openTransfer(page);
  await expect(page.getByRole("tab", { name: "Export" })).toHaveAttribute("aria-selected", "true");
  for (const label of ENTRIES) {
    const count = meta.counts[label.toLowerCase()];
    await expect(
      page.getByRole("checkbox", { name: new RegExp(`^${label}.*\\(${count}\\)`) }),
    ).toBeVisible();
  }
  await expect(
    page.getByText("Secret chỉ xuất tên, không xuất giá trị. Cấu hình agent xuất ở Agent Studio."),
  ).toBeVisible();
});

test("ADM-FR-54 · E-TR-02 · bỏ 'Chọn tất cả' → nút tải khoá + 'Chọn ít nhất một loại để xuất'", async ({
  page,
}) => {
  await openTransfer(page);
  await page.getByRole("checkbox", { name: "Chọn tất cả" }).uncheck();
  await expect(page.getByText("Chọn ít nhất một loại để xuất")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tải file config-v\d+\.yaml$/ })).toBeDisabled();
});

test("ADM-FR-54 · E-TR-03 · AC-A06 · tải config-v{n}.yaml: có tên secret DIFY_TRANSLATE_KEY, không có giá trị; toast 'Đã tải …'", async ({
  page,
}) => {
  const n = await configVersion();
  await openTransfer(page);
  const { download, text } = await downloadAll(page, n);
  expect(download.suggestedFilename()).toBe(`config-v${n}.yaml`);
  expect(text).toContain("DIFY_TRANSLATE_KEY");
  expect(text).not.toContain(LEAK_1);
  await expect(toast(page, `Đã tải config-v${n}.yaml`)).toBeVisible();
});

test("ADM-FR-54 · E-TR-04 · M4-AC09/10 · import baseFile: chip 'Thêm 2' 'Sửa 3' 'Không đổi k', ghi chú không xoá, 'Cần tạo secret' có DIFY_REPORT_KEY, 'Áp dụng 5 thay đổi' khoá", async ({
  page,
}) => {
  await toImport(page);
  await upload(page, FILE, baseFile());
  await expect(page.getByRole("button", { name: "Thêm 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sửa 3", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Không đổi \d+$/ })).toBeVisible();
  await expect(page.getByText("Import không xoá thực thể không có trong file.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Cần tạo secret" }).getByText("DIFY_REPORT_KEY"),
  ).toBeVisible();
  await expect(applyBtn(page)).toBeDisabled();
});

test("ADM-FR-54 · E-TR-05 · M4-AC10 · nhập giá trị secret → Áp dụng → Xác nhận: 200, toast 'Đã import · Thêm 2 · Sửa 3 · v{n+1}', về bước 1, secret có trong DB, giá trị không lộ", async ({
  page,
}) => {
  const n = await configVersion();
  const t = collectTraffic(page);
  await toImport(page);
  await upload(page, FILE, baseFile());
  const value = page.getByLabel("Giá trị DIFY_REPORT_KEY");
  await expect(value).toHaveAttribute("type", "password");
  await value.fill(LEAK_2);
  await applyBtn(page).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Áp dụng 5 thay đổi từ ${FILE}?`);
  const applied = page.waitForResponse(
    (r) => isImport(r.url()) && /dry_run=0/.test(r.url()) && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  expect((await applied).status()).toBe(200);
  await expect(toast(page, `Đã import · Thêm 2 · Sửa 3 · v${n + 1}`)).toBeVisible();
  await expect(anyApply(page)).toHaveCount(0);
  await expect(page.getByLabel("Chọn file")).toBeAttached();
  const found = await withOwner(
    (sql) => sql`select 1 from admin.secrets where name = 'DIFY_REPORT_KEY'`,
  );
  expect(found.length).toBe(1);
  // Request import hợp lệ mang giá trị; chỉ quét DOM, storage, console.
  const leaks = (await leaksOnPage(page, t, leakForms(LEAK_2))).filter(
    (k) => !["responses", "otherRequests"].includes(k),
  );
  expect(leaks).toEqual([]);
});

test("ADM-FR-54 · E-TR-06 · chip 'Thêm 2' = nút lọc aria-pressed, chỉ còn mục Thêm", async ({
  page,
}) => {
  await toImport(page);
  await upload(page, FILE, baseFile());
  const chip = page.getByRole("button", { name: "Thêm 2", exact: true });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Sửa 3", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByText("report-new", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("bao-cao-moi", { exact: true }).first()).toBeVisible();
  // các mục "Sửa" (translate, acme, bao-cao) bị ẩn
  for (const key of ["translate", "acme", "bao-cao"]) {
    await expect(page.getByText(key, { exact: true })).toHaveCount(0);
  }
});

test("ADM-FR-54 · E-TR-07 · file REF_NOT_FOUND → 'File không hợp lệ' + đường dẫn commands[0].workflow; không có nút Áp dụng", async ({
  page,
}) => {
  await toImport(page);
  const bad = toYaml({
    ...header(),
    commands: [{ ...commandEl("dich"), workflow: "translat" }],
  });
  await upload(page, "config-v7.yaml", bad);
  const alert = page.getByRole("alert").filter({ hasText: "File không hợp lệ" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("commands[0].workflow");
  await expect(anyApply(page)).toHaveCount(0);
});

test("ADM-FR-54 · E-TR-08 · R14 · x.json và file 1 048 577 byte bị chặn ở client, không gọi /admin/import", async ({
  page,
}) => {
  const imports: string[] = [];
  page.on("request", (r) => {
    if (isImport(r.url())) imports.push(r.url());
  });
  await toImport(page);
  await upload(page, "x.json", "{}");
  await expect(page.getByText("Chỉ nhận file .yaml hoặc .yml")).toBeVisible();
  await upload(page, "big.yaml", padTo(baseFile(), 1_048_577));
  await expect(page.getByText("File lớn hơn 1 MB")).toBeVisible();
  expect(imports).toEqual([]);
});

test("ADM-FR-54 · E-TR-09 · C-E09 · import đúng file vừa export → 'File không có thay đổi nào so với cấu hình hiện tại.', không nút Áp dụng", async ({
  page,
}) => {
  const n = await configVersion();
  await openTransfer(page);
  const { text } = await downloadAll(page, n);
  await page.getByRole("tab", { name: "Import" }).click();
  await upload(page, `config-v${n}.yaml`, text);
  await expect(
    page.getByText("File không có thay đổi nào so với cấu hình hiện tại."),
  ).toBeVisible();
  await expect(anyApply(page)).toHaveCount(0);
});

test("ADM-FR-54 · E-TR-10 · 409 · config đổi giữa dry-run và áp dụng → 'Cấu hình vừa thay đổi. Đã tạo lại bản xem trước.' + dry-run mới", async ({
  page,
  request,
}) => {
  await toImport(page);
  await upload(page, FILE, baseFile());
  await page.getByLabel("Giá trị DIFY_REPORT_KEY").fill(LEAK_2);
  await expect(applyBtn(page)).toBeEnabled();
  const api = await apiAsAdmin(request);
  const version = await versionOf("commands", ID.command.dich);
  const patched = await api.patch(`/admin/commands/${ID.command.dich}`, {
    version,
    description: { vi: "E-TR-10 đổi giữa chừng" },
  });
  expect(patched.status()).toBe(200);
  await applyBtn(page).click();
  const redo = page.waitForRequest((r) => isImport(r.url()) && /dry_run=1/.test(r.url()));
  const applied = page.waitForResponse((r) => isImport(r.url()) && /dry_run=0/.test(r.url()));
  await page.getByRole("alertdialog").getByRole("button", { name: "Xác nhận" }).click();
  expect((await applied).status()).toBe(409);
  await redo;
  await expect(page.getByText("Cấu hình vừa thay đổi. Đã tạo lại bản xem trước.")).toBeVisible();
});

test("ADM-FR-54 · E-TR-11 · binh (tenant_admin): không thấy 'Import / Export'; /transfer → 403", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await expect(page.getByRole("link", { name: "Import / Export" })).toHaveCount(0);
  await page.goto("/transfer");
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền xem trang này" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Import" })).toHaveCount(0);
});
