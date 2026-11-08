// cr126-journey-e2e · `test` của hành trình duyệt: MỌI browser context mà ca tự mở (`browser.newContext()`) được đóng khi ca kết thúc.
// Một trình duyệt sống lâu cho ~40 ca (workers 1) mà context mở không đóng ⇒ bộ nhớ phình, tiến trình GPU/trình duyệt bị SIGKILL giữa lượt chạy.
// Không ca nào chia trang cho ca khác (đã kiểm), nên đóng theo từng ca là an toàn.
import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ closeOpenedContexts: undefined }>({
  closeOpenedContexts: [
    async ({ browser }, use) => {
      const before = new Set(browser.contexts());
      await use(undefined);
      for (const ctx of browser.contexts()) {
        if (!before.has(ctx)) await ctx.close().catch(() => undefined);
      }
    },
    { auto: true },
  ],
});

export { expect };
