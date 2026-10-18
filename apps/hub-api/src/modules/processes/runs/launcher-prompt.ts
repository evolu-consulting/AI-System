// P-b · PF-S3 · HUB-FR-122/123 · PB-R05/R10/R13/R14 · prompt stage (MANIFEST + đầu vào + checklist) + cổng resolve nguồn.
// Tách khỏi `launcher.ts` cho giới hạn 400 dòng; chỉ hàm thuần/DB, không phát sự kiện. [HUB-FR-122]
import {
  HANDOFF_SECTION,
  HANDOFF_TOKENS_MAX,
  KH_SUMMARY_SECTION,
  KH_SUMMARY_WORDS,
  type ProcessInputValue,
  type SourcePin,
  type StageAutofix,
  type StageSource,
  sourceConfigOut,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { buildManifest, type ManifestItem } from "./sources.rules";
import type { ResolveSource } from "./stage-sources";

/** P-d1 · PD-R13 · executor `wait_until` trong snapshot (contract `WaitUntilExecutorSchema`; `time` đã có mặc định khi lưu). */
export type WaitUntilSnap = {
  kind: "wait_until";
  from: { kind: "input"; key: string } | { kind: "field"; stage_key: string; field: string };
  offset_days: number;
  time?: string;
};

export type SnapStage = {
  key: string;
  name: string;
  instruction: string;
  executor:
    | { kind: "agent"; agent_id: string }
    | { kind: "team"; team_id: string }
    | { kind: "apply" }
    | WaitUntilSnap;
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
  output: { filename: string; required_sections?: string[] };
  real_action: boolean;
  /** P-b2 · bước (vắng ⇒ mỗi stage một bước — `resolveSteps`). */
  step?: number;
  timeout_s: number;
  /** P-b · nguồn + checklist của stage (vắng ⇒ P-a). */
  sources?: StageSource[];
  must_know?: string[];
  /** P-c1 · cấu hình tự-sửa (vắng/null ⇒ stage thường). */
  autofix?: StageAutofix | null;
};

export type Head = {
  tenant_id: string;
  started_by: string;
  status: string;
  current_stage_idx: number;
  conversation_id: string;
  input: string;
  snapshot: {
    stages: SnapStage[];
    token_budget: number | null;
    sources?: ResolveSource[];
    /** K1 · đích `## Tóm tắt` theo stage (chốt lúc start; vắng = không đích). */
    kh?: { stages: (object | null)[] };
  };
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

/** R10 · stage có mục "Bàn giao" bắt buộc ⇒ nhắc độ dài (đếm ước chars/4, cắt khi chuyển bước sau). */
function handoffHint(stage: SnapStage): string | null {
  const want = HANDOFF_SECTION.toLowerCase();
  const has = (stage.output.required_sections ?? []).some((x) => x.trim().toLowerCase() === want);
  return has
    ? `Mục "## ${HANDOFF_SECTION}": tóm tắt cho bước sau, tối đa ${HANDOFF_TOKENS_MAX} token.`
    : null;
}

/** K1 · D10 · stage có đích `## Tóm tắt` (`snapshot.kh.stages[idx]` ≠ null). */
export const KH_SUMMARY_HINT = `Include a \`## ${KH_SUMMARY_SECTION}\` section (≤ ${KH_SUMMARY_WORDS} words).`;

/** K1 · stage `idx` có đích ghi Tóm tắt vào KnowledgeHub. */
export const hasKhSummaryTarget = (head: Head, idx: number): boolean =>
  (head.snapshot.kh?.stages?.[idx] ?? null) !== null;

/**
 * P-b2 · phần thêm của prompt: `extra` (khối Bàn giao, sau "Đầu vào") và `tail` (hỏi–đáp trước, nối cuối).
 * K1 · `khSummary` ⇒ dòng gợi ý D10 `## Tóm tắt`.
 */
export type PromptExtra = {
  extra?: readonly string[];
  tail?: string | null;
  khSummary?: boolean;
  /** P-c1 · plan §6.4 · khối `## Workspace` của stage tự-sửa — chèn NGAY sau instruction. */
  workspace?: string | null;
};

/**
 * Prompt stage (D6 rút gọn): instruction + input run + MANIFEST/đầu vào/checklist + Bàn giao bước trước + nhắc Bàn giao +
 * góp ý (làm lại) + hỏi–đáp trước (tiếp sau trả lời).
 */
export function promptOf(
  stage: SnapStage,
  head: Head,
  feedback: string | null,
  x: PromptExtra = {},
): string {
  const parts = [stage.instruction.trim(), x.workspace ?? "", head.input.trim()].filter(
    (p) => p.length > 0,
  );
  parts.push(...extraPromptParts(head, stage), ...(x.extra ?? []));
  const hint = handoffHint(stage);
  if (hint) parts.push(hint);
  if (x.khSummary) parts.push(KH_SUMMARY_HINT);
  if (feedback && feedback.trim().length > 0) parts.push(`Góp ý cần sửa:\n${feedback.trim()}`);
  if (x.tail) parts.push(x.tail);
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
  // P-c1 · PC-R04 · nguồn của stage tự-sửa ⇒ `caps: "autofix"` (trần snapshot riêng phía Runtime); vắng = `source`.
  const afKeys = new Set(
    head.snapshot.stages.flatMap((s) => (s.autofix ? [s.autofix.source_key] : [])),
  );
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
      // P-c2 · snapshot/nguồn cũ thiếu `credential_secret_id` ⇒ null (pydantic Runtime đòi trường).
      config: sourceConfigOut(s.config),
      allowlist_union: s.allowlist_union,
      ...(afKeys.has(s.key) ? { caps: "autofix" as const } : {}),
    })),
    timeout_s: RESOLVE_TIMEOUT_S,
  };
  await tx.execute(sql`insert into hub.jobs (id, tenant_id, user_id, type, payload, status)
    values (${jobId}, ${head.tenant_id}, ${head.started_by}, 'source.resolve',
      ${JSON.stringify(payload)}::jsonb, 'queued')`);
  return true;
}
