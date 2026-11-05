// CR-120 §2 · ADR-0036 · FLOW-FR-02 · `bun run check:app-slots` (pre-commit + `bun run check`/CI): mọi app trong `APP_MANIFESTS` khai báo
// ≥ 1 khe flow và ≥ 1 khe luôn bật; khe đúng hợp đồng `AppSlotDecl`. Luật ở `appSlotIssues` (unit: slots.rules.test.ts).
import { APP_MANIFESTS, appSlotIssues, formatSlotIssue } from "@ai/contracts";

const issues = appSlotIssues(Object.values(APP_MANIFESTS));
if (issues.length > 0) {
  console.error(`check:app-slots: ${issues.length} lỗi khai báo khe (ADR-0036)`);
  for (const i of issues) console.error(`  ${formatSlotIssue(i)}`);
  process.exit(1);
}
console.log(`check:app-slots: ${Object.keys(APP_MANIFESTS).length} app, khe hợp lệ`);
