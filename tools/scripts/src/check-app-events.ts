// CR-122 · ADR-0038 · FLOW2-FR-17 · `bun run check:app-events` (thay dần `check:app-slots`, R1 gỡ cái cũ): mọi app trong `APP_MANIFESTS`
// khai ≥ 1 sự kiện đúng hợp đồng `AppEventDecl`; sự kiện `required` có flow mặc định trong seed Thư viện (migration hub).
// Luật ở `appEventIssues` (unit: events.rules.test.ts). BẪY: flow mặc định hiện chỉ là def khe cũ (chưa có `trigger`) ⇒ thiếu/không
// có trong seed mới CẢNH BÁO; M1 (0107 backfill FlowDef) bật `STRICT_DEFAULT_FLOW = true` để đỏ.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_MANIFESTS,
  type AppManifest,
  appEventIssues,
  appNodeIssues,
  formatEventIssue,
} from "@ai/contracts/app-manifest";

const STRICT_DEFAULT_FLOW = false;
const MIGRATIONS_HUB = join(import.meta.dir, "../../../packages/db/migrations-hub");

/** Khoá flow mặc định (`defaultFlowKey`) xuất hiện dạng chuỗi SQL `'<khoá>'` trong ít nhất một migration hub. */
export function seededKeysIn(
  sqlTexts: readonly string[],
  manifests: readonly AppManifest[],
): Set<string> {
  const keys = manifests.flatMap((m) => m.events.flatMap((e) => e.defaultFlowKey ?? []));
  return new Set(keys.filter((k) => sqlTexts.some((t) => t.includes(`'${k}'`))));
}

function main(): void {
  const manifests = Object.values(APP_MANIFESTS);
  const sqls = readdirSync(MIGRATIONS_HUB)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_HUB, f), "utf8"));
  const issues = appEventIssues(manifests, {
    seededFlowKeys: seededKeysIn(sqls, manifests),
    strictDefaultFlow: STRICT_DEFAULT_FLOW,
  });
  for (const i of issues)
    (i.level === "error" ? console.error : console.warn)(`  ${formatEventIssue(i)}`);
  // CR-122 · N1 · FLOW2-FR-25 · node lõi + node của app (`nodes[]`): mọi vi phạm là lỗi.
  const nodeIssues = appNodeIssues(manifests);
  for (const n of nodeIssues)
    console.error(`  LỖI ${n.app}${n.node ? ` · ${n.node}` : ""}: ${n.rule}`);
  const errors = issues.filter((i) => i.level === "error").length + nodeIssues.length;
  if (errors > 0) {
    console.error(`check:app-events: ${errors} lỗi khai báo sự kiện (ADR-0038)`);
    process.exit(1);
  }
  console.log(`check:app-events: ${manifests.length} app, sự kiện hợp lệ`);
}

if (import.meta.main) main();
