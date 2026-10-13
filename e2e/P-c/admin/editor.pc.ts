// HUB-FR-119 · HUB-FR-126 · HUB-BR-34 · ADM-FR-65 · P-c1 · e2e admin editor (test-plan P-c §4 E01–E02; plan-frontend §1.1, §3, §5;
// mockup Pc-Editor): khối "Tự sửa mã" trong panel "Chi tiết giai đoạn" — bật, chọn Nguồn, nhập lệnh, Lưu (PUT 200), mở lại giữ
// giá trị; def `pc-bad` (2 stage tự-sửa, stage 2 tự chạy, nguồn library) ⇒ câu lỗi `err.AUTOFIX_MAX/REVIEW/sourceKind`. Seed SQL
// `seedEditor` (jsonb — nạp được trước code). Chưa có khối ⇒ đỏ ở locator `switch "Tự sửa mã"`.
import { expect, type Page, test } from "@playwright/test";
import { defByKey, node, openDef, panel, saveDef, seedEditor } from "../_pc-support";

test.beforeAll(() => seedEditor());

const afSwitch = (p: Page) => panel(p).getByRole("switch", { name: "Tự sửa mã" });

test("HUB-FR-126 · ADM-FR-65 · E01 · bật 'Tự sửa mã', chọn Nguồn pc-repo, 'Lệnh kiểm thử' + 'Đường dẫn được sửa' ⇒ Lưu 200; mở lại đúng giá trị; ghi chú mạng hiện", async ({
  page: p,
}) => {
  await openDef(p, "pc-edit", "Tự sửa E2E");
  await node(p, "Sửa lỗi").click();
  await afSwitch(p).click();
  await expect(afSwitch(p)).toBeChecked();
  await expect(
    panel(p).getByText("Container chạy agent và test không có mạng.", { exact: false }),
  ).toBeVisible();
  await panel(p).getByRole("combobox", { name: "Nguồn" }).click();
  await p.getByRole("option", { name: /pc-repo/ }).click();
  await panel(p).getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("bun test src");
  await panel(p).getByRole("textbox", { name: "Đường dẫn được sửa" }).fill("src/**");
  await expect(panel(p).getByText("Hợp lệ")).toBeVisible();
  expect(await saveDef(p)).toBe(200);
  const def = await defByKey("pc-edit");
  expect(def.stages?.[0]?.autofix).toEqual({
    source_key: "pc-repo",
    install_cmd: null,
    test_cmd: "bun test src",
    write_allowlist: ["src/**"],
  });
  await p.reload();
  await node(p, "Sửa lỗi").click();
  await expect(afSwitch(p)).toBeChecked();
  await expect(panel(p).getByRole("textbox", { name: "Lệnh kiểm thử" })).toHaveValue(
    "bun test src",
  );
  await expect(panel(p).getByRole("combobox", { name: "Nguồn" })).toContainText("pc-repo");
});

test("HUB-BR-34 · PC-R02 · E02 · def pc-bad: stage 'Sửa B' ⇒ alert AUTOFIX_REVIEW + AUTOFIX_MAX (đã có ở 'Sửa A'); xoá lệnh test ⇒ err.test", async ({
  page: p,
}) => {
  await openDef(p, "pc-bad", "Tự sửa lỗi cấu hình");
  await node(p, "Sửa B").click();
  const alerts = p.getByRole("alert");
  await expect(
    alerts.filter({
      hasText: 'Stage tự sửa mã luôn phải qua người duyệt. Chọn "Duyệt" ở mục Sau stage.',
    }),
  ).toBeVisible();
  await expect(
    alerts.filter({ hasText: 'Mỗi quy trình chỉ có một stage tự sửa mã. Đã có ở stage "Sửa A".' }),
  ).toBeVisible();
  await panel(p).getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("");
  await expect(alerts.filter({ hasText: "Nhập lệnh kiểm thử (tối đa 1000 ký tự)." })).toBeVisible();
});

test("HUB-FR-126 · PC-R01 · E02b · def pc-libsrc (nguồn library) ⇒ Lưu 422 PROCESS_REF_INVALID ⇒ alert ô Nguồn 'Nguồn \"pc-lib\" thuộc loại library…'", async ({
  page: p,
}) => {
  await openDef(p, "pc-libsrc", "Tự sửa nguồn tài liệu");
  await node(p, "Sửa lỗi").click();
  await expect(afSwitch(p)).toBeChecked();
  await panel(p).getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("bun test docs");
  expect(await saveDef(p)).toBe(422);
  await expect(
    p.getByRole("alert").filter({
      hasText:
        'Nguồn "pc-lib" thuộc loại library, không sửa được. Chọn nguồn git_remote hoặc local_path.',
    }),
  ).toBeVisible();
});
