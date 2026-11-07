// ADM-FR-71 · HUB-FR-146 · HUB-BR-12 · AC-H44 · D2-49 · TECH-DEBT #204 (hướng A) · test-plan-e2e PD2-E06: giai đoạn ở bước 0
// chọn "Gọi tool" + tool có tác dụng phụ ⇒ công tắc "Hành động thật" bị khoá VÀ câu lỗi nói rõ không bật được (khoá
// `process.admin.editor.stage.tool.err.sideEffectLocked`), KHÔNG bảo người dùng bật công tắc (câu `TOOL_SIDE_EFFECT` cũ).
// Seed `pd2-tool` (s0 "Đọc hồ sơ" đứng một mình ở bước 0) qua `seedPd2Defs`. KHÔNG Lưu ⇒ không đổi dữ liệu của ca khác.
import { expect, test } from "@playwright/test";
import { node, openDef, panel, seedPd, seedPd2Defs, seedPd2Tools } from "./_pd-support";

test.beforeAll(() => seedPd());

const LOCKED_VI =
  "Tính năng có tác động thật cần “Hành động thật”, nhưng bước này không bật được: mọi bước ở phía trước phải có người duyệt.";
const OLD_VI = "Tính năng có tác động thật chỉ dùng được khi bước bật “Hành động thật”.";

test("ADM-FR-71 · AC-H44 · PD2-E06 · bước 0 'Gọi tool' chọn 'Ghi sổ · ghi-so' (tác dụng phụ) ⇒ 'Hành động thật' khoá + câu 'không bật được', không câu bảo bật", async ({
  page: p,
}) => {
  await seedPd2Tools();
  await seedPd2Defs();
  await openDef(p, "pd2-tool", "Gọi tool E2E");
  await node(p, "Đọc hồ sơ").click();
  await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
  await p.getByRole("option", { name: "Chạy tính năng" }).click();
  const g = panel(p).getByRole("group", { name: "Chạy tính năng" });
  await g.getByRole("combobox", { name: "Tính năng" }).click();
  await p.getByRole("option", { name: /Ghi sổ · ghi-so/ }).click();
  await expect(g.getByText("Việc này có tác động thật (gửi đi, ghi dữ liệu)")).toBeVisible();

  await expect(panel(p).getByRole("switch", { name: "Hành động thật" })).toBeDisabled();
  await expect(panel(p).getByText(LOCKED_VI)).toBeVisible();
  await expect(panel(p).getByText(OLD_VI)).toHaveCount(0);
});
