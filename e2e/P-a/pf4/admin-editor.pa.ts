// ADM-FR-66 · e2e P-a PF4 · E-P15b (test-plan-e2e §2; plan-frontend-e2e §2 Editor): mở `hoa-don-t` (fixture, Group kiểm sẵn)
// ⇒ `region "Giai đoạn 1: Đọc hoá đơn"`, `combobox "Nhóm kiểm"`, `switch "Hành động thật"` disabled ở giai đoạn 1; đổi Nhóm
// kiểm ⇒ "Lưu" ⇒ bật được; sửa song song (PUT /process-defs/:id trước) ⇒ ConflictDialog (409); mở mẫu `sdlc` ⇒ "Đây là quy trình mẫu, chỉ
// xem. Chép mẫu để chỉnh sửa.".
import { expect, test } from "@playwright/test";
import { adminLogin, hub, settle, tok } from "../_pa-support";

test.afterEach(() => settle());

test('ADM-FR-66 · E-P15b · editor: Nhóm kiểm + "Hành động thật" disabled ở stage 1; Lưu ⇒ bật được; sửa song song ⇒ ConflictDialog; mẫu ⇒ "Đây là quy trình mẫu, chỉ xem…"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await p.getByRole("link", { name: "Quy trình", exact: true }).click();
    const row = p
      .getByRole("table", { name: "Quy trình" })
      .getByRole("row")
      .filter({ hasText: "hoa-don-t" });
    await row.getByRole("link", { name: "Hoá đơn T" }).click();
    const s1 = p.getByRole("region", { name: "Giai đoạn 1: Đọc hoá đơn" });
    await expect(s1).toBeVisible();
    await expect(s1.getByRole("switch", { name: "Hành động thật" })).toBeDisabled();
    await s1.getByRole("combobox", { name: "Nhóm kiểm" }).click();
    await p.getByRole("option", { name: "Tech lead" }).click();
    await p.getByRole("button", { name: "Lưu" }).click();
    await expect(p.getByRole("switch", { name: "Bật" })).toBeEnabled();

    // sửa song song: đổi mô tả qua API admin (Hub) trước khi Lưu ⇒ 409 ⇒ ConflictDialog
    await p.getByRole("textbox", { name: "Mô tả" }).fill("Sửa ở tab 1");
    const list = await hub(await tok("Adm"), "GET", "/process-defs?include_templates=false");
    const item = (list.json?.items ?? []).find((d: { key: string }) => d.key === "hoa-don-t");
    expect(item, "GET /process-defs có hoa-don-t").toBeTruthy();
    const def = (await hub(await tok("Adm"), "GET", `/process-defs/${item.id}`)).json;
    const { id, tenant_id, is_template, source_template_id, created_at, updated_at, ...input } =
      def;
    void [tenant_id, is_template, source_template_id, created_at, updated_at];
    const put = await hub(await tok("Adm"), "PUT", `/process-defs/${id}`, {
      ...input,
      description: "Sửa ở nơi khác",
    });
    expect(put.status).toBe(200);
    await p.getByRole("button", { name: "Lưu" }).click();
    await expect(
      p
        .getByRole("alertdialog")
        .or(p.getByRole("dialog"))
        .filter({ hasText: /thay đổi|xung đột/i }),
    ).toBeVisible();

    // mẫu: chỉ xem
    await p.getByRole("link", { name: "Quy trình", exact: true }).click();
    await p.getByRole("tab", { name: "Mẫu" }).click();
    await p
      .getByRole("table", { name: "Quy trình" })
      .getByRole("row")
      .filter({ hasText: "!sdlc" })
      .getByRole("link")
      .first()
      .click();
    await expect(
      p.getByText("Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa."),
    ).toBeVisible();
    await expect(p.getByRole("button", { name: "Chép mẫu" })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
