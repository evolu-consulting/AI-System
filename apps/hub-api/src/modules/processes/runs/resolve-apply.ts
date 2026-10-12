// P-b · PF-S3 · PB-R05 · HUB-BR-27 · áp kết quả resolve vào run quy trình: mọi item ok ⇒ ghim `pinned_sources` (thứ tự
// `snapshot.sources`) + kick stage 0; có item lỗi ⇒ `needs_decision(source_unresolvable)`. Idempotent (khoá run, đã ghim ⇒
// bỏ). Scope system. Dùng bởi `SourcesResolvedService` qua `ResolveBridge`. [HUB-FR-122]
import type { SourcePin } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { publishUserEvents } from "../../../lib/user-stream";
import type { ResolveReport } from "../../sources/resolve.bridge";
import * as core from "../core/core.repo";
import type { ProcessDeps } from "../core/ports";
import { firstIdxOfStep } from "../core/step.rules";
import { stepsOfSnap } from "./step-persist";
import { headOf, stageRowOf, toDecision } from "./team-runner";

const SYSTEM = { kind: "system" } as const;

export async function applyResolveReport(d: ProcessDeps, r: ResolveReport): Promise<void> {
  const hasError = r.results.some((x) => x.status === "error");
  const pinBySource = new Map<string, SourcePin>();
  for (const x of r.results) if (x.status === "ok") pinBySource.set(x.source_id, x.pin);

  const outcome = await withHubScope(d.db, SYSTEM, async (tx) => {
    const head = await headOf(tx, r.runId);
    if (!head) return null;
    const locked = await core.lockRun(tx, head.tenant_id, r.runId);
    // Trước ghim không stage nào chạy ⇒ run chỉ `running`; `needs_decision` (đã báo lỗi nguồn) ⇒ bỏ (không mở trùng).
    if (locked?.status !== "running") return null;
    const [cur] = await tx.execute<{ pinned: unknown }>(
      sql`select pinned_sources as pinned from hub.process_runs where id = ${r.runId}`,
    );
    if (Array.isArray(cur?.pinned)) return null; // đã ghim (idempotent / gửi trùng)
    // P-b2 §3.8 · source_unresolvable gắn vào stage đầu của bước hiện tại (D3/D4).
    const idx = firstIdxOfStep(stepsOfSnap(head.snapshot), Number(locked.currentStep));
    if (hasError) {
      const stage = await stageRowOf(tx, r.runId, idx);
      if (!stage) return null;
      const events = await toDecision(d, tx, {
        runId: r.runId,
        tenantId: head.tenant_id,
        idx,
        stageRunId: stage.id,
        reason: "source_unresolvable",
      });
      return { kind: "decided" as const, events };
    }
    const defSources = (head.snapshot as { sources?: { source_id: string }[] }).sources ?? [];
    const pins = defSources
      .map((s) => pinBySource.get(s.source_id))
      .filter((p): p is SourcePin => p !== undefined);
    await tx.execute(sql`update hub.process_runs set pinned_sources = ${JSON.stringify(pins)}::jsonb,
      sources_pinned_at = now(), updated_at = now() where id = ${r.runId}`);
    return { kind: "pinned" as const, events: [] };
  });
  if (!outcome) return;
  if (outcome.events.length > 0) await publishUserEvents(d.redis, outcome.events, d.log);
  await d.postThread(r.runId).catch(() => {});
  if (outcome.kind === "pinned") await d.launcher.kick(r.runId);
}
