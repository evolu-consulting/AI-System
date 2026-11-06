// ADM-FR-67 · e2e P-a PF4 · E-P15c (CR-121: tenant_admin không còn nút "Chạy" ở danh sách; lượt chạy do chat/!key tạo, admin xem ở trang lượt chạy).
// Giữ mục tiêu ca cũ: trang lượt chạy có tab Tiến độ/Token/Nhật ký, Token khớp Σ usage_logs; run needs_decision ⇒ 3 nút xử lý.
import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, DEF_HD_T, seedRun, settle, usageSum } from "../_pa-support";

test.afterEach(() => settle());

test("ADM-FR-67 · E-P15c · Adm mở trang lượt chạy: Tiến độ/Token/Nhật ký, Token khớp Σ; run needs_decision ⇒ 3 nút", async ({
  browser,
}) => {
  const done = await seedRun(null, "done", { usage: true });
  const dec = await seedRun(null, "needs_decision");
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${DEF_HD_T.id}/runs/${done.runId}`);
    for (const t of ["Tiến độ", "Token", "Nhật ký"])
      await expect(p.getByRole("tab", { name: t })).toBeVisible();
    await p.getByRole("tab", { name: "Token" }).click();
    const sum = await usageSum(done.runId);
    expect(sum).toBeGreaterThan(0);
    await expect(p.getByTestId("process-total-tokens")).toContainText(sum.toLocaleString("vi-VN"));

    await p.goto(`${ADMIN_URL}/processes/${DEF_HD_T.id}/runs/${dec.runId}`);
    for (const o of ["Thêm 1 lần làm lại", "Dùng bản hiện có", "Huỷ lượt chạy"])
      await expect(p.getByRole("button", { name: o })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
