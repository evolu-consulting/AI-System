// ADM-FR-67 · e2e P-a PF4 ⇢PF1 · E-P15c (test-plan-e2e §2; plan-frontend-e2e §2): Adm "Chạy" ⇒ `dialog "Chạy quy trình Hoá
// đơn T"` `textbox "Nội dung đầu vào"` ⇒ run mới; trang run có `tab "Tiến độ"`/`"Token"`/`"Nhật ký"`, Token khớp Σ usage_logs;
// run `needs_decision` ⇒ 3 nút "Thêm 1 lần làm lại" / "Dùng bản hiện có" / "Huỷ lượt chạy".
import { expect, test } from "@playwright/test";
import { adminLogin, rtScript, seedRun, settle, usageSum } from "../_pa-support";

test.afterEach(() => settle());

test('ADM-FR-67 · E-P15c · Adm "Chạy" ⇒ run mới trong danh sách; trang run có Tiến độ/Token/Nhật ký, Token khớp Σ; run needs_decision ⇒ 3 nút', async ({
  browser,
}) => {
  const dec = await seedRun(null, "needs_decision");
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await rtScript("hoa-don-t", 0, [{ kind: "done" }, { kind: "hold" }]);
    await adminLogin(p);
    await p.getByRole("link", { name: "Quy trình", exact: true }).click();
    await p.getByRole("tab", { name: "Mẫu · chạy thử" }).click(); // CR-105: def tenant không khe/không của gói nằm ở tab này
    const row = p
      .getByRole("table", { name: "Quy trình" })
      .getByRole("row")
      .filter({ hasText: "hoa-don-t" });
    await row.getByRole("button", { name: "Chạy" }).click();
    const dlg = p.getByRole("dialog", { name: "Chạy quy trình Hoá đơn T" });
    await dlg.getByRole("textbox", { name: "Nội dung đầu vào" }).fill("HD-15 admin");
    await dlg.getByRole("button", { name: "Chạy" }).click();
    await expect(p.getByText("Đã bắt đầu lượt chạy")).toBeVisible();

    await row.getByRole("link", { name: "Hoá đơn T" }).click();
    await p.getByRole("tab", { name: "Lượt chạy" }).click();
    await p
      .getByRole("row")
      .filter({ hasText: "Binh Le" })
      .first()
      .getByRole("link")
      .first()
      .click();
    for (const t of ["Tiến độ", "Token", "Nhật ký"])
      await expect(p.getByRole("tab", { name: t })).toBeVisible();
    const runId = p.url().match(/[0-9a-f-]{36}/)?.[0] ?? "";
    await p.getByRole("tab", { name: "Token" }).click();
    const sum = await usageSum(runId);
    expect(sum).toBeGreaterThan(0);
    await expect(p.getByTestId("process-total-tokens")).toContainText(sum.toLocaleString("vi-VN"));

    const url = p.url().replace(runId, dec.runId);
    await p.goto(url);
    for (const o of ["Thêm 1 lần làm lại", "Dùng bản hiện có", "Huỷ lượt chạy"])
      await expect(p.getByRole("button", { name: o })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
