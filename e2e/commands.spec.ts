// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24, ADM-BR-01, ADM-BR-10 · e2e Commands (test-plan E-C; AC-A03; M2-R17, R19).
// Nhãn nguyên văn: admin-missing-screens §2 + plan-frontend §5. Workflow/feature/entitlement dựng bằng owner SQL.
import { expect, type Page, test } from "@playwright/test";
import { ID, loginAdmin, openPage, resetFixture, toast, withOwner } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

/** Hàng bảng Commands theo tên (`/dich` không nhầm `/dich-moi`). */
const row = (page: Page, name: string) =>
  page
    .getByRole("table", { name: "Commands" })
    .getByRole("row")
    .filter({ hasText: new RegExp(`/${name}(?![\\w-])`) });
const rowMenu = async (page: Page, name: string, item: string) => {
  await row(page, name).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};
const SOURCES = [
  "Tham số",
  "Đoạn bôi đen",
  "URL trang",
  "Nội dung trang",
  "File đính kèm",
  "ID người dùng",
  "ID tenant",
  "Giá trị cố định",
];
const source = (page: Page, input: string) =>
  page.getByRole("combobox", { name: `Nguồn của ${input}` });
const pickSource = async (page: Page, input: string, label: string) => {
  await source(page, input).click();
  await page.getByRole("option", { name: label, exact: true }).click();
};
const pickWorkflow = async (page: Page, key: string) => {
  await page.getByRole("combobox", { name: "Workflow", exact: true }).click();
  await page
    .getByRole("option", { name: new RegExp(`(?<![\\w-])${key}(?![\\w-])`) })
    .first()
    .click();
};
const fillBasics = async (page: Page, name: string) => {
  await page.getByRole("textbox", { name: "Tên command" }).fill(name);
  await page.getByRole("textbox", { name: "Mô tả", exact: true }).fill("Mô tả command kiểm thử");
};
const openNew = async (page: Page, qs = "") => {
  await page.goto(`/commands/new${qs}`);
  await expect(page.getByRole("textbox", { name: "Tên command" })).toBeVisible();
};

test("ADM-FR-20 · M2-R26 · /commands: heading, bảng, /dich có alias tr + switch 'Bật command /dich', combobox Feature/Workflow, chip Tất cả 5 / Bật 3 / Tắt 2", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  await expect(page.getByRole("link", { name: "+ Tạo command" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Tìm theo tên, alias, mô tả…" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Feature" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Workflow" })).toBeVisible();
  await expect(row(page, "dich")).toContainText("tr");
  await expect(row(page, "dich").getByRole("switch", { name: "Bật command /dich" })).toBeChecked();
  for (const [label, n] of [
    ["Tất cả", 5],
    ["Bật", 3],
    ["Tắt", 2],
  ] as const) {
    await expect(page.getByRole("radio", { name: new RegExp(`${label}\\s*${n}`) })).toBeVisible();
  }
});

test("ADM-BR-06 · ADM-FR-20 · tắt /dich → toast 'Đã tắt /dich' + 'Hoàn tác' (bấm trong 5 s → bật lại, PATCH kèm version); /xuat-bao-cao có switch khoá + tooltip 'Bật workflow report-export trước'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  const sw = row(page, "dich").getByRole("switch", { name: "Bật command /dich" });
  const off = page.waitForResponse(
    (r) => r.url().includes("/admin/commands/") && r.request().method() === "PATCH",
  );
  await sw.click();
  expect((await off).status()).toBe(200);
  const t = toast(page, "Đã tắt /dich");
  await expect(t).toBeVisible();
  const undo = page.waitForResponse(
    (r) => r.url().includes("/admin/commands/") && r.request().method() === "PATCH",
  );
  await t.getByRole("button", { name: "Hoàn tác" }).click();
  const undone = await undo;
  expect(undone.status()).toBe(200);
  expect(JSON.parse(undone.request().postData() ?? "{}")).toMatchObject({ enabled: true });
  await expect(sw).toBeChecked();
  const locked = row(page, "xuat-bao-cao").getByRole("switch", {
    name: "Bật command /xuat-bao-cao",
  });
  await expect(locked).toBeDisabled();
  await locked.hover();
  await expect(page.getByText("Bật workflow report-export trước")).toBeVisible();
});

test("ADM-FR-23 · X1 F4 · editor command có nút 'Chạy thử'; ADM-FR-20 · menu ⋯ vẫn không có 'Lịch sử'", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/commands/${ID.command.dich}`);
  await expect(page.getByRole("textbox", { name: "Tên command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chạy thử", exact: true }).first()).toBeVisible();
  await openPage(page, "/commands", "Commands");
  await row(page, "dich").getByRole("button", { name: "Thao tác khác" }).click();
  await expect(page.getByRole("menuitem", { name: "Lịch sử" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Nhân bản" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Xoá" })).toBeVisible();
});

test("ADM-BR-01 · CR-055 · bước 1: tên '/Dịch' → 'dich'; alias thêm/bỏ; feature mặc định core, bỏ hết → gợi ý 'Chưa gắn feature' (không chặn); tên trùng dich → lỗi trước khi lưu", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  await page.getByRole("link", { name: "+ Tạo command" }).click();
  await expect(page).toHaveURL(/\/commands\/new$/);
  const name = page.getByRole("textbox", { name: "Tên command" });
  await name.fill("/Dịch");
  await expect(name).toHaveValue("dich");
  await name.blur();
  await expect(page.getByText("/dich đã được dùng bởi command khác")).toBeVisible();
  await name.fill("dich-moi");
  await expect(page.getByText("/dich-moi đã được dùng bởi command khác")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Alias" }).fill("tr2");
  await page.getByRole("button", { name: "Thêm alias" }).click();
  await expect(page.getByRole("button", { name: "Bỏ alias tr2" })).toBeVisible();
  await page.getByRole("button", { name: "Bỏ alias tr2" }).click();
  await expect(page.getByRole("button", { name: "Bỏ alias tr2" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bỏ feature core" }).click();
  await expect(page.getByText(/^Chưa gắn feature — không ai dùng được command này/)).toBeVisible();
  await page.getByRole("combobox", { name: "Thêm feature" }).click();
  await page
    .getByRole("option", { name: /core|Cơ bản/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Bỏ feature core" })).toBeVisible();
});

test("ADM-FR-22 · AC-A03 · thiếu map target_lang → Lưu KHÔNG gửi request, alert 'thiếu input bắt buộc: target_lang', combobox aria-invalid; map đủ → lưu → /commands/<uuid> + toast", async ({
  page,
}) => {
  await loginAdmin(page);
  await openNew(page);
  await fillBasics(page, "dich-moi");
  await pickWorkflow(page, "translate");
  await expect(page.getByRole("textbox", { name: "Output field" })).toHaveValue("text");
  await pickSource(page, "source_text", "Đoạn bôi đen");
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/admin/commands")) posts.push(r.url());
  });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "thiếu input bắt buộc: target_lang" }),
  ).toBeVisible();
  await expect(source(page, "target_lang")).toHaveAttribute("aria-invalid", "true");
  expect(posts).toEqual([]);
  await pickSource(page, "target_lang", "Giá trị cố định");
  await page.getByRole("textbox", { name: "Giá trị của target_lang" }).fill("vi");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/commands") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/commands\/[0-9a-f-]{36}$/);
  await expect(toast(page, "Đã lưu /dich-moi")).toBeVisible();
});

test("ADM-FR-21 · M2-R16 · 8 nguồn: combobox 'Nguồn của target_lang' liệt kê đủ 8 nhãn; 'Tham số' → combobox 'Tham số của target_lang'; 'Giá trị cố định' → textbox 'Giá trị của target_lang'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openNew(page);
  await pickWorkflow(page, "translate");
  await source(page, "target_lang").click();
  const options = page.getByRole("option");
  for (const label of SOURCES) {
    await expect(options.filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
  }
  await page.getByRole("option", { name: "Tham số", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Tham số của target_lang" })).toBeVisible();
  await pickSource(page, "target_lang", "Giá trị cố định");
  await expect(page.getByRole("textbox", { name: "Giá trị của target_lang" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tham số của target_lang" })).toHaveCount(0);
});

test("ADM-FR-22 · M2-R17 · map SAI KIỂU chỉ cảnh báo: invoice_file (file) ← 'Đoạn bôi đen' → combobox có aria-describedby (cảnh báo), vẫn Lưu được (201)", async ({
  page,
}) => {
  await loginAdmin(page);
  await openNew(page, `?workflow=${ID.workflow.invoiceCheck}`);
  await fillBasics(page, "hoa-don-2");
  await pickSource(page, "invoice_file", "Đoạn bôi đen");
  await expect(source(page, "invoice_file")).toHaveAttribute("aria-describedby", /.+/);
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/commands") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  const res = await saved;
  expect(res.status()).toBe(201);
  expect(((await res.json()) as { warnings: unknown[] }).warnings).toHaveLength(1);
});

test("ADM-FR-20 · ui-admin 7.4 · đổi workflow ở command đã có map → Alert 'Đã bỏ map của: …' liệt kê input bị bỏ", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/commands/${ID.command.dich}`);
  await expect(page.getByRole("textbox", { name: "Tên command" })).toBeVisible();
  await pickWorkflow(page, "summarize");
  const info = page.getByRole("alert").filter({ hasText: "Đã bỏ map của:" });
  await expect(info).toBeVisible();
  await expect(info).toContainText("source_text");
  await expect(info).toContainText("target_lang");
});

test("ADM-FR-20 · M2-R15 · bước 5: output field điền sẵn từ workflow, radio async → timeout 120, timeout 601 → 'Timeout từ 1 đến 600 giây', combobox 'Hiển thị'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openNew(page);
  await pickWorkflow(page, "translate");
  await expect(page.getByRole("textbox", { name: "Output field" })).toHaveValue("text");
  await expect(page.getByRole("combobox", { name: "Hiển thị" })).toBeVisible();
  const timeout = page.getByRole("spinbutton", { name: "Timeout (giây)" });
  await expect(timeout).toHaveValue("30");
  await page.getByRole("radio", { name: "async", exact: true }).check();
  await expect(timeout).toHaveValue("120");
  await timeout.fill("601");
  await timeout.blur();
  await expect(page.getByText("Timeout từ 1 đến 600 giây")).toBeVisible();
});

test("ADM-FR-20 · ui-admin 7.4 · nhân bản /dich → /commands/new?from=<id>, tên dich-copy, Tắt, không alias; Lưu → 201 enabled=false", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  await rowMenu(page, "dich", "Nhân bản");
  await expect(page).toHaveURL(new RegExp(`/commands/new\\?.*from=${ID.command.dich}`));
  await expect(page.getByRole("textbox", { name: "Tên command" })).toHaveValue("dich-copy");
  await expect(page.getByText("Bản sao của /dich: đã tắt, không có alias.")).toBeVisible();
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/commands") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(201);
  const [c] = await withOwner(
    (sql) => sql`select enabled, aliases from admin.commands where name = 'dich-copy'`,
  );
  expect(c).toMatchObject({ enabled: false, aliases: [] });
});

test("CR-055 · hộp xoá /dich nói rõ command là danh mục chung (mất ở MỌI công ty) + cách bỏ khỏi một công ty; /tr-nhanh bỏ hết feature → badge 'Chưa gắn feature' ở danh sách", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  await rowMenu(page, "dich", "Xoá");
  const dialog = page.getByRole("alertdialog", { name: "Xoá /dich?" });
  await expect(dialog).toContainText("MỌI công ty");
  await expect(dialog).toContainText("thu hồi feature của công ty đó");
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, "tr-nhanh")).not.toContainText("Chưa gắn feature");
  await withOwner(
    (sql) => sql`delete from admin.feature_commands where command_id = ${ID.command.trNhanh}`,
  );
  await page.reload();
  await expect(row(page, "tr-nhanh")).toContainText("Chưa gắn feature");
});

test("ADM-FR-20 · M2-R26 · xoá /tr-nhanh: alertdialog 'Xoá /tr-nhanh?' gõ tên → nút 'Xoá command' → toast 'Đã xoá /tr-nhanh'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/commands", "Commands");
  await rowMenu(page, "tr-nhanh", "Xoá");
  const dialog = page.getByRole("alertdialog", { name: "Xoá /tr-nhanh?" });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Xoá command" });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Gõ tr-nhanh để xác nhận" }).fill("tr-nhanh");
  const deleted = page.waitForResponse(
    (r) => r.url().includes("/admin/commands/") && r.request().method() === "DELETE",
  );
  await submit.click();
  expect((await deleted).status()).toBe(204);
  await expect(toast(page, "Đã xoá /tr-nhanh")).toBeVisible();
  await expect(row(page, "tr-nhanh")).toHaveCount(0);
});

test("ADM-FR-24 · M2-R23 · tab 'Ai dùng được' của /dich: bảng tenant acme/globex/platform/zeta/bulk, tổng '5 tenant · 66 user' (gồm tenant bulk 55 user của fixture e2e). Card 'chưa khả dụng' bỏ ở M3 (kiểm ở access-command.spec); tạo mới thì tab khoá", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/commands/${ID.command.dich}`);
  const tab = page.getByRole("tab", { name: /Ai dùng được/ });
  await expect(tab).toContainText("5 tenant · 66 user");
  await tab.click();
  const table = page.getByRole("tabpanel").getByRole("table");
  for (const key of ["acme", "globex", "platform", "zeta", "bulk"]) {
    await expect(table.getByRole("row").filter({ hasText: key })).toBeVisible();
  }
  await expect(table.getByRole("row").filter({ hasText: "acme" })).toContainText("6");
  await openNew(page);
  await expect(page.getByRole("tab", { name: /Ai dùng được/ })).toBeDisabled();
});

test("ADM-BR-01 · M2-R13 · COMMAND_NAME_TAKEN từ server: tên được người khác chiếm giữa lúc điền → Lưu → lỗi inline '/dich-late đã được dùng bởi command khác'", async ({
  page,
}) => {
  await loginAdmin(page);
  await openNew(page);
  await fillBasics(page, "dich-late");
  await pickWorkflow(page, "report-tax");
  await withOwner(async (sql) => {
    const id = "01900000-0000-7000-8000-0000000002c1";
    await sql`insert into admin.commands (id, name, description, workflow_id, output)
      values (${id}, 'dich-late', ${sql.json({ vi: "Chiếm tên" })}, ${ID.workflow.reportTax},
        ${sql.json({ field: "text", render: "text" })})`;
    await sql`insert into admin.command_names (name, command_id) values ('dich-late', ${id})`;
    await sql`insert into admin.feature_commands (feature_id, command_id)
      select id, ${id} from admin.features where key = 'core'`;
  });
  const saved = page.waitForResponse(
    (r) => r.url().includes("/admin/commands") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(409);
  await expect(page.getByText("/dich-late đã được dùng bởi command khác")).toBeVisible();
});
