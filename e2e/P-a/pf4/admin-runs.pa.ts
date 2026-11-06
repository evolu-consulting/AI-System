// ADM-FR-67 · e2e P-a PF4 · E-P15c (CR-121: tenant_admin không còn nút "Chạy" ở danh sách; lượt chạy do chat/!key tạo, admin xem ở trang lượt chạy).
// 1) trang lượt chạy: tab Tiến độ/Token/Nhật ký, Token khớp Σ usage_logs; run needs_decision ⇒ 3 nút xử lý.
// 2) lượt chạy không tồn tại ⇒ "Không tìm thấy" (không bị đưa về Tổng quan).
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, DEF_HD_T, seedRun, settle, usageSum } from "../_pa-support";

test.afterEach(() => settle());

/** Ghi lại URL cuối + phản hồi `/process*` để lỗi điều hướng có chẩn đoán (không im lặng về Tổng quan). */
function trace(p: Page): () => string {
  const seen: string[] = [];
  p.on("response", (r) => {
    if (/\/process/.test(r.url())) seen.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return () => `URL cuối: ${p.url()}\n${seen.join("\n")}`;
}

test("ADM-FR-67 · E-P15c · Adm mở trang lượt chạy: Tiến độ/Token/Nhật ký, Token khớp Σ; run needs_decision ⇒ 3 nút", async ({
  browser,
}) => {
  const done = await seedRun(null, "done", { usage: true });
  const dec = await seedRun(null, "needs_decision");
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const why = trace(p);
  try {
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${DEF_HD_T.id}/runs/${done.runId}`);
    // trang lượt chạy (c-run): danh sách bước + mục "Dòng thời gian" + mục "Token" (thu gọn được)
    await expect(p.getByRole("list", { name: "Các bước của lượt chạy" }), why()).toBeVisible();
    await expect(p.getByRole("button", { name: /^Dòng thời gian/ })).toBeVisible();
    await p.getByRole("button", { name: "Token", exact: true }).click();
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

// (khối "Đang chạy" ở Công ty › Quy trình: stack P-a không có gói contracts ở Hub nên tab Quy trình trống ⇒ ca nằm ở hành trình journey, chưa có lượt chạy sẵn — việc còn lại)

test("ADM-FR-67 · lượt chạy không tồn tại ⇒ 'Không tìm thấy', không bị đưa về Tổng quan", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const why = trace(p);
  try {
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${DEF_HD_T.id}/runs/${randomUUID()}`);
    await expect(p.getByText("Không tìm thấy").first(), why()).toBeVisible();
    await expect(p.getByRole("heading", { level: 1, name: "Tổng quan" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
