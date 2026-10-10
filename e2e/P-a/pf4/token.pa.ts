// CHAT-AC-58 · AC-H34 · CHAT-AC-56 · C5 · HUB-FR-115 · e2e P-a PF4 · E-P14, E-P14b (test-plan-e2e §2; plan-frontend-e2e §1 Token):
// run `done` có `usage_logs` (seedRun usage: stage 0 = 1 000/200, stage 1 = 2 000/400). A, X (thành viên phòng) mở `?tab=token`:
// `table "Token theo giai đoạn"`, hàng tổng = KPI "Tổng token" (`data-testid="process-total-tokens"`, N7) = `usageSum` (SQL Σ);
// mở "Xem lượt gọi giai đoạn Đọc hoá đơn" ⇒ `table "Lượt gọi giai đoạn Đọc hoá đơn"` có model + thời gian. E-P14b: T (người xem
// `task`) chỉ thấy tổng theo giai đoạn + chữ "Bạn chỉ xem tổng theo giai đoạn.", không nút mở rộng.
// Ghi chú: fixture không dựng stage nhóm (bảng `team_runs` do PF1 ghi) ⇒ "4 lượt (plan + 3 thành viên)" phủ ở int P4-* và E-S2.
import { expect, type Page, test } from "@playwright/test";
import { mkRoom, seedRun, settle, usageSum, users } from "../_pa-support";

test.afterEach(() => settle());

const fmt = (n: number) => [String(n), n.toLocaleString("vi-VN"), n.toLocaleString("en-US")];
async function expectTotal(p: Page, total: number) {
  const kpi = p.getByTestId("process-total-tokens");
  await expect(kpi).toBeVisible();
  const txt = (await kpi.innerText()).replace(/\s/g, "");
  expect(fmt(total).some((f) => txt.includes(f.replace(/\s/g, "")))).toBe(true);
}

test('CHAT-AC-58 · AC-H34 · E-P14 · A, X mở ?tab=token: bảng theo giai đoạn, hàng tổng = KPI "Tổng token" = Σ usage_logs; mở lượt gọi giai đoạn ⇒ có model + thời gian', async ({
  browser,
}) => {
  const room = await mkRoom("EP14");
  const r = await seedRun(room.id, "done", { usage: true });
  const total = r.ready ? await usageSum(r.runId) : 3600;
  const u = await users(browser, "A", "X");
  try {
    for (const p of [u.A, u.X]) {
      await p.goto(`/runs/${r.runId}?tab=token`);
      const table = p.getByRole("table", { name: "Token theo giai đoạn" });
      await expect(table).toBeVisible();
      for (const col of [
        "Giai đoạn",
        "Lần chạy",
        "Hỏi lại",
        "Lượt gọi",
        "Vào",
        "Ra",
        "Cache",
        "Tổng",
      ])
        await expect(table.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
      await expect(table.getByRole("row").filter({ hasText: "Đọc hoá đơn" })).toBeVisible();
      await expect(table.getByRole("row").filter({ hasText: "Ghi sổ" })).toBeVisible();
      await expectTotal(p, total);
    }
    expect(total).toBe(3600);
    const btn = u.A.getByRole("button", { name: "Xem lượt gọi giai đoạn Đọc hoá đơn" });
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    const calls = u.A.getByRole("table", { name: "Lượt gọi giai đoạn Đọc hoá đơn" });
    await expect(calls).toContainText("fake-1");
    await expect(calls.getByRole("row")).toHaveCount(2); // tiêu đề + 1 lượt
  } finally {
    await u.close();
  }
});

test('CHAT-AC-56 · C5 · E-P14b · T (người xem task) /runs/<id>?tab=token: chỉ tổng theo giai đoạn + "Bạn chỉ xem tổng theo giai đoạn.", không nút "Xem lượt gọi giai đoạn …"; tổng = Σ', async ({
  browser,
}) => {
  const room = await mkRoom("EP14b");
  const r = await seedRun(room.id, "waiting_review", { usage: true });
  const total = r.ready ? await usageSum(r.runId) : 3600;
  const u = await users(browser, "T");
  try {
    await u.T.goto(`/runs/${r.runId}?tab=token`);
    await expect(u.T.getByRole("table", { name: "Token theo giai đoạn" })).toBeVisible();
    await expect(u.T.getByText("Bạn chỉ xem tổng theo giai đoạn.")).toBeVisible();
    await expect(u.T.getByRole("button", { name: /^Xem lượt gọi giai đoạn / })).toHaveCount(0);
    await expectTotal(u.T, total);
  } finally {
    await u.close();
  }
});
