// CR-122 · E1 · FLOW2-FR-01/02/15 · luật THUẦN khi lưu def có `trigger` (FlowDef): `parseFlowDef` + `flowDefIssues(def, events của app)`.
// Def không trigger (cũ / khe / chạy thử) ⇒ không áp. `trigger`/`app` vắng ở body ⇒ lấy giá trị đang lưu (cập nhật một phần).
import { getAppManifest } from "@ai/contracts/app-manifest";
import { flowDefIssues, type ProcessDefInput, parseFlowDef } from "@ai/contracts/hub-admin";

type Cur = { trigger: ProcessDefInput["trigger"] | null; app: string | null } | null;

/** Đường dẫn lỗi (≤ 20) — rỗng ⇒ hợp lệ. `tenantId` null ⇒ flow Thư viện, có ⇒ bản công ty. */
export function flowDefPaths(input: ProcessDefInput, tenantId: string | null, cur: Cur): string[] {
  const trigger = input.trigger === undefined ? (cur?.trigger ?? null) : input.trigger;
  if (!trigger) return [];
  const app = input.app === undefined ? (cur?.app ?? null) : input.app;
  const m = app ? getAppManifest(app) : undefined;
  if (!app || !m) return ["app"];
  const r = parseFlowDef({
    key: input.key,
    name: input.name,
    app,
    owner: tenantId === null ? "library" : "company",
    trigger,
    stages: input.stages,
  });
  if (!r.ok) return r.issues.map((i) => i.path).slice(0, 20);
  return r.legacy ? [] : flowDefIssues(r.def, m.events).map((i) => i.path);
}
