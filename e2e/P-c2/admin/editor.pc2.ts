// HUB-BR-34 · HUB-BR-38(b) · HUB-FR-129 · ADM-FR-65 · PC2-R01 · P-c2 · e2e admin editor (test-plan P-c2 §4 E06–E07; plan-frontend §1.2,
// FC9, FC10, §5; mockup Pc2-Editor): kiểu "Người thực hiện" = "Áp bản sửa" ⇒ "Hành động thật" bật + khoá, "Hợp lệ", Lưu ⇒ executor
// {kind:'apply'}, real_action, after auto; def `pc2-bad` (2 stage Áp nối tiếp) ⇒ alert APPLY_MAX + APPLY_NO_AUTOFIX ở "Áp 2".
// Chưa có UI ⇒ đỏ ở option "Áp bản sửa".
import { expect, test } from "@playwright/test";
import { defByKey, node, openDef, panel, saveDef, seedPc2Admin } from "../_pc2-support";

test.beforeAll(() => seedPc2Admin());

test("HUB-FR-129 · FC9 · E06 · stage 'Áp thử' ⇒ 'Người thực hiện' = 'Áp bản sửa': 'Hành động thật' bật + khoá, 'Hợp lệ'; Lưu 200 ⇒ executor apply, real_action true, after auto", async ({
  page: p,
}) => {
  await openDef(p, "pc2-edit", "Áp E2E");
  await node(p, "Áp thử").click();
  await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
  await p.getByRole("option", { name: "Áp bản sửa" }).click();
  const real = panel(p).getByRole("switch", { name: "Hành động thật" });
  await expect(real).toBeChecked();
  await expect(real).toBeDisabled();
  await expect(panel(p).getByText("Hợp lệ")).toBeVisible();
  expect(await saveDef(p)).toBe(200);
  const st = (await defByKey("pc2-edit")).stages?.[1];
  expect({ ex: st?.executor, real: st?.real_action, after: st?.after?.kind }).toEqual({
    ex: { kind: "apply" },
    real: true,
    after: "auto",
  });
});

test("HUB-BR-34 · PC2-R01 · FC10 · E07 · def pc2-bad: stage 'Áp 2' ⇒ alert 'Mỗi quy trình chỉ có một stage Áp. Đã có ở stage \"Áp 1\".' + 'Stage Áp phải đứng ngay sau stage tự sửa mã.'", async ({
  page: p,
}) => {
  await openDef(p, "pc2-bad", "Áp lỗi cấu hình");
  await node(p, "Áp 2").click();
  const alerts = p.getByRole("alert");
  await expect(
    alerts.filter({ hasText: 'Mỗi quy trình chỉ có một stage Áp. Đã có ở stage "Áp 1".' }),
  ).toBeVisible();
  await expect(
    alerts.filter({ hasText: "Stage Áp phải đứng ngay sau stage tự sửa mã." }),
  ).toBeVisible();
});
