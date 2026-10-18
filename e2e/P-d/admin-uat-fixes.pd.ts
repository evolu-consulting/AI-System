// HUB-FR-146 · P-d2 · UAT B-D2-3: danh sách Lượt chạy admin — run đang thử lại ⇒ huy hiệu "Đang chạy" (mockup 03 D1). SQL dựng trạng thái.
import { expect, test } from "@playwright/test";
import { mkRoom, openDef, seedPd, seedTimerRun, settle } from "./_pd-support";

test.beforeAll(() => seedPd());
test.afterEach(() => settle());

test("HUB-FR-146 · B-D2-3 · danh sách Lượt chạy admin: run đang thử lại ⇒ huy hiệu 'Đang chạy' + 'Thử lại lúc', không 'Đang chờ hẹn'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD2B3");
  const r = await seedTimerRun(room.id, "retry");
  expect(r.ready).toBe(true);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await openDef(p, "hoa-don-t", "Hoá đơn T");
    await p.getByRole("tab", { name: "Lượt chạy" }).click();
    const row = p.getByRole("row").filter({ hasText: `#${r.runId.slice(0, 8)}` });
    await expect(row).toContainText("Thử lại lúc");
    await expect(row).toContainText("Đang chạy");
    await expect(row).not.toContainText("Đang chờ hẹn");
  } finally {
    await ctx.close();
  }
});
