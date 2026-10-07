// HUB-FR-96 · e2e X2a · dữ liệu cố định dùng chung cho `_x2a-stack.ts` (bun) và `_x2a-support.ts` (Playwright). Không import
// `@playwright/test`. 48 user acme thêm: id `a2e00000-…-0000000000NN`, username `qe01…qe48`, tên "QC Người 01…48".
export const QE = Array.from({ length: 48 }, (_, i) => ({
  id: `a2e00000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  username: `qe${String(i + 1).padStart(2, "0")}`,
  display_name: `QC Người ${String(i + 1).padStart(2, "0")}`,
}));
