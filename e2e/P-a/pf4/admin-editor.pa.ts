// ADM-FR-66 · e2e P-a PF4 · E-P15b (test-plan-e2e §2; plan-frontend-e2e §2 Editor): mở `hoa-don-t` (fixture, Group kiểm sẵn)
// ⇒ `region "Giai đoạn 1: Đọc hoá đơn"`, `combobox "Nhóm kiểm"`, `switch "Hành động thật"` disabled ở giai đoạn 1; đổi Nhóm
// kiểm ⇒ "Lưu" ⇒ bật được; sửa song song (PUT /process-defs/:id trước) ⇒ ConflictDialog (409); mở mẫu `sdlc` ⇒ "Đây là quy trình mẫu, chỉ
// xem. Chép mẫu để chỉnh sửa.".
import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, hub, settle, tok } from "../_pa-support";

test.afterEach(() => settle());

// CR-121 c15: hộp "Tạo quy trình" theo công ty đã gỡ (c13) ⇒ mở quy trình/mẫu thẳng theo id (Hub), không qua danh sách theo công ty.
const defId = async (kind: "sample" | "template", key: string): Promise<string> => {
  const list = await hub(await tok("Adm"), "GET", `/process-defs?kind=${kind}&limit=100`);
  const item = (list.json?.items ?? []).find((d: { key: string }) => d.key === key);
  expect(item, `GET /process-defs?kind=${kind} có ${key}`).toBeTruthy();
  return item.id;
};

test('ADM-FR-66 · E-P15b · editor: Nhóm kiểm + "Hành động thật" disabled ở stage 1; Lưu ⇒ bật được; sửa song song ⇒ ConflictDialog; mẫu ⇒ "Đây là quy trình mẫu, chỉ xem…"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${await defId("sample", "hoa-don-t")}`); // fnr-editor-drawer (qc, người dùng chốt ngăn chi tiết đóng mặc định 2026-10-29): bấm node để mở ngăn.
    await p
      .getByRole("application", { name: "Canvas quy trình" })
      .getByRole("button", { name: /^Giai đoạn 1: Đọc hoá đơn/ })
      .click();
    const s1 = p.getByRole("region", { name: "Giai đoạn 1: Đọc hoá đơn" });
    await expect(s1).toBeVisible();
    await expect(s1.getByRole("switch", { name: "Hành động thật" })).toBeDisabled();
    await s1.getByRole("combobox", { name: "Nhóm kiểm" }).click();
    await p.getByRole("option", { name: "Tech lead" }).click();
    await p.getByRole("button", { name: "Lưu" }).click();
    await expect(p.getByRole("switch", { name: "Bật" })).toBeEnabled();

    // sửa song song: đổi mô tả qua API admin (Hub) trước khi Lưu ⇒ 409 ⇒ ConflictDialog
    await p.getByRole("textbox", { name: "Mô tả" }).fill("Sửa ở tab 1");
    const list = await hub(await tok("Adm"), "GET", "/process-defs?kind=sample");
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
    const conflict = p.getByRole("alertdialog", { name: /Có người vừa lưu/ });
    await expect(conflict).toBeVisible();
    // ConflictDialog là modal (Escape/click nền không đóng) ⇒ đóng bằng "Tải bản mới" trước khi điều hướng
    await conflict.getByRole("button", { name: "Tải bản mới" }).click();
    await expect(conflict).toHaveCount(0);

    // mẫu: chỉ xem (mở thẳng mẫu sdlc theo id)
    await p.goto(`${ADMIN_URL}/processes/${await defId("template", "sdlc")}`);
    await expect(
      p.getByText("Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa."),
    ).toBeVisible();
    await expect(p.getByRole("button", { name: "Chép mẫu" })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
