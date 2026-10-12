// P-b · PF-S3 · HUB-FR-122/123 · PB-R05/R10/R13/R14 · prompt stage (MANIFEST + đầu vào + checklist) + cổng resolve nguồn.
// Tách khỏi `launcher.ts` cho giới hạn 400 dòng; chỉ hàm thuần/DB, không phát sự kiện. [HUB-FR-122]
import type { ProcessInputValue, SourcePin, StageSource } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { buildManifest, type ManifestItem } from "./sources.rules";
import type { ResolveSource } from "./stage-sources";

export type SnapStage = {
  key: string;
  name: string;
  instruction: string;
  executor: { kind: "agent"; agent_id: string } | { kind: "team"; team_id: string };
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
  output: { filename: string };
  real_action: boolean;
  /** P-b2 · bước (vắng ⇒ mỗi stage một bước — `resolveSteps`). */
  step?: number;
  timeout_s: number;
  /** P-b · nguồn + checklist của stage (vắng ⇒ P-a). */
  sources?: StageSource[];
  must_know?: string[];
};

export type Head = {
  tenant_id: string;
  started_by: string;
  status: string;
  current_stage_idx: number;
  conversation_id: string;
  input: string;
  snapshot: { stages: SnapStage[]; token_budget: number | null; sources?: ResolveSource[] };
  /** P-b · pin đã ghim (song song `snapshot.sources`); NULL = chưa resolve. */
  pinned_sources: SourcePin[] | null;
  /** P-b · đầu vào run (ProcessInputValue[]). */
  inputs: ProcessInputValue[] | null;
};

/** key → pin (song song `snapshot.sources`/`pinned_sources`). */
function pinsByKey(head: Head): Record<string, SourcePin> {
  const defs = head.snapshot.sources ?? [];
  const pinned = head.pinned_sources;
  const map: Record<string, SourcePin> = {};
  if (Array.isArray(pinned))
    defs.forEach((s, i) => {
      const p = pinned[i];
      if (p) map[s.key] = p;
    });
  return map;
}

/** PB-R10/HUB-BR-31 · MANIFEST của stage (thứ tự `stage.sources`, pin đã ghim, mô tả từ def-level). */
function manifestItems(head: Head, stage: SnapStage): ManifestItem[] {
  const byKey = new Map((head.snapshot.sources ?? []).map((s) => [s.key, s] as const));
  const pins = pinsByKey(head);
  const out: ManifestItem[] = [];
  for (const ss of stage.sources ?? []) {
    const src = byKey.get(ss.source_key);
    const pin = pins[ss.source_key];
    if (src && pin) out.push({ key: src.key, description: src.description, pin });
  }
  return out;
}

/** PB-R13/R14 · MANIFEST + checklist must_know + đầu vào vào prompt (text/select/source_ref; nhãn = key). */
function extraPromptParts(head: Head, stage: SnapStage): string[] {
  const parts: string[] = [];
  const items = manifestItems(head, stage);
  if (items.length > 0) parts.push(buildManifest(items));
  const mk = stage.must_know ?? [];
  if (mk.length > 0)
    parts.push(`Cần làm rõ (hỏi nếu còn thiếu):\n${mk.map((m) => `- ${m}`).join("\n")}`);
  const inputs = Array.isArray(head.inputs) ? head.inputs : [];
  const lines = inputs.map((i) =>
    i.type === "text"
      ? `${i.key}: ${i.text}`
      : i.type === "select"
        ? `${i.key}: ${i.value}`
        : i.type === "source_ref"
          ? `${i.key}: ${i.source_key}@${i.branch}`
          : `${i.key}: (tệp)`,
  );
  if (lines.length > 0) parts.push(`Đầu vào:\n${lines.join("\n")}`);
  return parts;
}

/** Prompt stage (D6 rút gọn): instruction + input run + MANIFEST/đầu vào/checklist + góp ý (làm lại). */
export function promptOf(stage: SnapStage, head: Head, feedback: string | null): string {
  const parts = [stage.instruction.trim(), head.input.trim()].filter((p) => p.length > 0);
  parts.push(...extraPromptParts(head, stage));
  if (feedback && feedback.trim().length > 0) parts.push(`Góp ý cần sửa:\n${feedback.trim()}`);
  return parts.join("\n\n") || stage.name;
}

const RESOLVE_TIMEOUT_S = 120;

/** PB-R05 · true = đã enqueue (hoặc đang có) job `source.resolve` ⇒ gate stage. Run đã khoá FOR UPDATE ở `plan`. */
export async function gateResolve(tx: Tx, runId: string, head: Head): Promise<boolean> {
  const defs = head.snapshot.sources ?? [];
  if (defs.length === 0 || head.pinned_sources !== null) return false;
  const [existing] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.jobs
    where type = 'source.resolve' and payload->>'process_run_id' = ${runId}
      and status in ('queued', 'running') limit 1`);
  if (existing) return true;
  const jobId = crypto.randomUUID();
  const payload = {
    v: 1,
    type: "source.resolve",
    job_id: jobId,
    tenant_id: head.tenant_id,
    process_run_id: runId,
    items: defs.map((s) => ({
      source_id: s.source_id,
      key: s.key,
      kind: s.kind,
      config: s.config,
      allowlist_union: s.allowlist_union,
    })),
    timeout_s: RESOLVE_TIMEOUT_S,
  };
  await tx.execute(sql`insert into hub.jobs (id, tenant_id, user_id, type, payload, status)
    values (${jobId}, ${head.tenant_id}, ${head.started_by}, 'source.resolve',
      ${JSON.stringify(payload)}::jsonb, 'queued')`);
  return true;
}
