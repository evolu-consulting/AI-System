// ADM-FR-10, ADM-FR-11, ADM-FR-13, ADM-FR-14, ADM-FR-15 · e2e Workflows (test-plan E-W; AC-A05, AC-A13, M2-AC07).
// Nhãn nguyên văn: plan-frontend §5. Command/agent dựng bằng owner SQL (fixture), không phụ thuộc màn Commands.
import { expect, type Page, test } from "@playwright/test";
import { ID, loginAdmin, openPage, resetFixture, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

/** Hàng bảng Workflows theo key (không nhầm 'report-tax' với 'report-tax-2'). */
const wfRow = (page: Page, key: string) =>
  page
    .getByRole("table", { name: "Workflows" })
    .getByRole("row")
    .filter({ hasText: new RegExp(`(?<![\\w-])${key}(?![\\w-])`) });
const rowMenu = async (page: Page, key: string, item: string) => {
  await wfRow(page, key).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};
/** Mở trang editor (mới/sửa) và chờ ô Key ở tab Thông tin (không phụ thuộc nhãn heading). */
const openEditor = async (page: Page, path: string) => {
  await page.goto(path);
  await expect(page.getByRole("textbox", { name: "Key", exact: true })).toBeVisible();
};
const desc = (n: number) => "d".repeat(n);
const descBox = (page: Page) => page.getByRole("textbox", { name: "Mô tả", exact: true });
const DESC_ERR = "Mô tả dài 20–400 ký tự";

test("ADM-FR-14 · M2-R26 · /workflows: heading, bảng, chip Tất cả 5 / Bật 4 / Tắt 1 / Chưa gắn 1, hàng report-tax có 'Chưa gắn'; chip 'Chưa gắn' → URL status=unattached và API attached=false; tìm kiếm", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflows");
  await expect(page.getByRole("table", { name: "Workflows" })).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Khai báo workflow" })).toBeVisible();
  for (const [label, n] of [
    ["Tất cả", 5],
    ["Bật", 4],
    ["Tắt", 1],
    ["Chưa gắn", 1],
  ] as const) {
    await expect(page.getByRole("radio", { name: new RegExp(`${label}\\s*${n}`) })).toBeVisible();
  }
  await expect(wfRow(page, "report-tax")).toContainText("Chưa gắn");
  const resp = page.waitForResponse(
    (r) => r.url().includes("/admin/workflows") && r.url().includes("attached=false"),
  );
  await page.getByRole("radio", { name: /Chưa gắn/ }).click();
  await resp;
  await expect(page).toHaveURL(/status=unattached/);
  await expect(wfRow(page, "report-tax")).toBeVisible();
  await expect(wfRow(page, "translate")).toHaveCount(0);
  await page.getByRole("radio", { name: /Tất cả/ }).click();
  await page.getByRole("searchbox", { name: "Tìm theo tên, key, mô tả…" }).fill("invoice");
  await expect(wfRow(page, "invoice-check")).toBeVisible();
  await expect(wfRow(page, "translate")).toHaveCount(0);
});

test("ADM-FR-10 · M2-AC07 · form khai báo: mô tả 19 ký tự → lỗi, 20 → hết lỗi, 400 ok, 401 → lỗi; Base URL ftp:// → lỗi; bỏ trống + Lưu → lỗi, không gửi request", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflows");
  await page.getByRole("link", { name: "+ Khai báo workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/new$/);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/admin/workflows")) posts.push(r.url());
  });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText(DESC_ERR)).toBeVisible();
  expect(posts).toEqual([]);
  const box = descBox(page);
  await box.fill(desc(19));
  await box.blur();
  await expect(page.getByText(DESC_ERR)).toBeVisible();
  await box.fill(desc(20));
  await box.blur();
  await expect(page.getByText(DESC_ERR)).toHaveCount(0);
  await box.fill(desc(400));
  await box.blur();
  await expect(page.getByText(DESC_ERR)).toHaveCount(0);
  await box.fill(desc(401));
  await box.blur();
  await expect(page.getByText(DESC_ERR)).toBeVisible();
  const url = page.getByRole("textbox", { name: "Base URL", exact: true });
  await url.fill("ftp://x.example.com");
  await url.blur();
  await expect(
    page.getByText("Nhập URL http:// hoặc https:// hợp lệ, không kèm tên đăng nhập"),
  ).toBeVisible();
});

test("ADM-FR-14 · AC-A13 · khai báo workflow không gắn command/agent: lưu được → /workflows/<uuid>, badge 'Chưa gắn'; danh sách có nhãn 'Chưa gắn'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEditor(page, "/workflows/new");
  await page.getByRole("textbox", { name: "Key", exact: true }).fill("report-tax-2");
  await page.getByRole("textbox", { name: "Tên", exact: true }).fill("Report tax 2");
  await page.getByRole("combobox", { name: "Secret" }).click();
  await page.getByRole("option", { name: /DIFY_OLD_KEY/ }).click();
  await page
    .getByRole("textbox", { name: "Base URL", exact: true })
    .fill("https://dify.example.com/v1");
  await descBox(page).fill(desc(30));
  await page.getByRole("button", { name: "+ Thêm tham số" }).click();
  await page.getByRole("textbox", { name: "Tên tham số 1" }).fill("period");
  await page.getByRole("textbox", { name: "Mô tả tham số 1" }).fill("Kỳ báo cáo thuế");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/workflows") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Chưa gắn").first()).toBeVisible();
  await openPage(page, "/workflows", "Workflows");
  await expect(wfRow(page, "report-tax-2")).toContainText("Chưa gắn");
});

test("ADM-FR-11 · M2-R08 · SchemaEditor: Kiểu=select → hiện 'Lựa chọn 1'; mô tả tham số rỗng → lỗi; ↑↓ đổi thứ tự; xoá tham số; tối đa 50 → '+ Thêm tham số' bị khoá", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEditor(page, `/workflows/${ID.workflow.reportTax}`);
  await page.getByRole("tab", { name: "Input" }).click();
  await page.getByRole("button", { name: "+ Thêm tham số" }).click();
  await page.getByRole("textbox", { name: "Tên tham số 1" }).fill("first");
  await page.getByRole("combobox", { name: "Kiểu 1" }).click();
  await page.getByRole("option", { name: "select", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Lựa chọn 1" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Bắt buộc 1" }).check();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("Mô tả tham số là bắt buộc")).toBeVisible();
  await page.getByRole("textbox", { name: "Mô tả tham số 1" }).fill("Tham số đầu");
  await page.getByRole("textbox", { name: "Lựa chọn 1" }).fill("a, b");
  await page.getByRole("button", { name: "+ Thêm tham số" }).click();
  await page.getByRole("textbox", { name: "Tên tham số 2" }).fill("second");
  await page.getByRole("textbox", { name: "Mô tả tham số 2" }).fill("Tham số hai");
  await page.getByRole("button", { name: "Chuyển tham số 2 lên" }).click();
  await expect(page.getByRole("textbox", { name: "Tên tham số 1" })).toHaveValue("second");
  await page.getByRole("button", { name: "Xoá tham số 1" }).click();
  await expect(page.getByRole("textbox", { name: "Tên tham số 1" })).toHaveValue("first");
  await expect(page.getByRole("textbox", { name: "Tên tham số 2" })).toHaveCount(0);
});

test("ADM-FR-11 · M2-R08 · tối đa 50 tham số: nút '+ Thêm tham số' bị khoá kèm 'Tối đa 50 tham số'", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    const params = Array.from({ length: 50 }, (_, i) => ({
      name: `p${i}`,
      type: "text",
      required: false,
      description: `Tham số ${i}`,
    }));
    await sql`update admin.workflows set input_schema = ${sql.json(params)} where id = ${ID.workflow.reportTax}`;
  });
  await loginAdmin(page);
  await openEditor(page, `/workflows/${ID.workflow.reportTax}`);
  await page.getByRole("tab", { name: "Input" }).click();
  await expect(page.getByRole("textbox", { name: "Tên tham số 50" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Thêm tham số" })).toBeDisabled();
  await expect(page.getByText("Tối đa 50 tham số")).toBeVisible();
});

test("ADM-FR-11 · M2-R08 · tab 'Model thấy gì': preview đúng tên tham số, chỉ đọc, không gọi server khi chuyển tab", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEditor(page, `/workflows/${ID.workflow.translate}`);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/")) calls.push(r.url());
  });
  await page.getByRole("tab", { name: "Model thấy gì" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("source_text");
  await expect(panel).toContainText("target_lang");
  await expect(panel).toContainText("required");
  expect(calls).toEqual([]);
});

test("ADM-FR-13 · AC-A05 · xoá translate (command /dich + agent …02a1): alertdialog 'Không xoá được translate' liệt kê link '/dich' và 'Agent …', nút Đóng; workflow vẫn còn", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflows");
  await rowMenu(page, "translate", "Xoá");
  const dialog = page.getByRole("alertdialog", { name: /Không xoá được translate/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "/dich" })).toBeVisible();
  await expect(dialog).toContainText("Agent …");
  await dialog.getByRole("button", { name: "Đóng" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(wfRow(page, "translate")).toBeVisible();
});

test("ADM-FR-15 · M2-R10 · cột 'Đang được dùng bởi' mở Popover: command + agent; tab 'Đang được dùng bởi' của translate hiện cả hai", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEditor(page, `/workflows/${ID.workflow.translate}`);
  await page.getByRole("tab", { name: "Đang được dùng bởi" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("link", { name: "/dich" })).toBeVisible();
  await expect(panel).toContainText("Agent …");
});

test("ADM-FR-13 · M2-R11 · xoá workflow không dùng (report-tax): alertdialog 'Xoá report-tax?' gõ key mới bật 'Xoá workflow' → biến mất khỏi bảng", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflows");
  await rowMenu(page, "report-tax", "Xoá");
  const dialog = page.getByRole("alertdialog", { name: "Xoá report-tax?" });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Xoá workflow" });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Gõ report-tax để xác nhận" }).fill("report-tax");
  const deleted = page.waitForResponse(
    (r) => r.url().includes("/admin/workflows/") && r.request().method() === "DELETE",
  );
  await submit.click();
  expect((await deleted).status()).toBe(204);
  await expect(toast(page, "Đã xoá report-tax")).toBeVisible();
  await expect(wfRow(page, "report-tax")).toHaveCount(0);
});

test("ADM-FR-13 · M2-AC06 · tắt translate khi còn command bật/agent → dialog chặn 'Không tắt được translate'; tắt/bật report-export (không command bật) thành công", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/workflows", "Workflows");
  await rowMenu(page, "translate", "Tắt");
  const blocked = page.getByRole("alertdialog", { name: /Không tắt được translate/ });
  await expect(blocked).toBeVisible();
  await expect(blocked.getByRole("link", { name: "/dich" })).toBeVisible();
  await blocked.getByRole("button", { name: "Đóng" }).click();
  await rowMenu(page, "report-export", "Bật");
  await expect(toast(page, "Đã bật report-export")).toBeVisible();
  await rowMenu(page, "report-export", "Tắt");
  await expect(toast(page, "Đã tắt report-export")).toBeVisible();
});

test("ADM-FR-22 · M2-AC08 · xoá tham số target_lang ở editor translate + Lưu → Alert 'Không lưu được: thay đổi này làm hỏng các command sau' + /dich; DB không đổi", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEditor(page, `/workflows/${ID.workflow.translate}`);
  await page.getByRole("tab", { name: "Input" }).click();
  await expect(page.getByRole("textbox", { name: "Tên tham số 2" })).toHaveValue("target_lang");
  await page.getByRole("button", { name: "Xoá tham số 2" }).click();
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/workflows/") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(409);
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Không lưu được: thay đổi này làm hỏng các command sau" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("/dich");
  const [row] = await withOwner(
    (sql) =>
      sql`select jsonb_array_length(input_schema) as n from admin.workflows where id = ${ID.workflow.translate}`,
  );
  expect(row?.n).toBe(3);
});

test("ADM-FR-12 · ADM-FR-20 · M2 không có nút 'Kiểm tra kết nối' / 'Lấy từ Dify'; link 'Tạo command từ workflow này' → /commands/new?workflow=<id>", async ({
  page,
}) => {
  await loginAdmin(page);
  await openEditor(page, `/workflows/${ID.workflow.translate}`);
  await expect(page.getByRole("button", { name: /Kiểm tra kết nối|Lấy từ Dify/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Input" }).click();
  await expect(page.getByRole("button", { name: /Kiểm tra kết nối|Lấy từ Dify/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Tạo command từ workflow này" }).click();
  await expect(page).toHaveURL(new RegExp(`/commands/new\\?.*workflow=${ID.workflow.translate}`));
});
