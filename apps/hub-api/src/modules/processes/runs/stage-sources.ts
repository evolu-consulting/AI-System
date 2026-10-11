// P-b · PF-S3 · HUB-FR-122/123 · PB-R05/R10/R11 · nguồn đã ghim của run → payload.sources / MANIFEST / pins / audit.
// `snapshot.sources` (def-level, chốt lúc start) song song `pinned_sources` (SourcePin[], cùng thứ tự). Dùng chung
// launcher (prompt/MANIFEST) + stage-driver (payload + audit). Chỉ đọc jsonb; không I/O ngoài tx truyền vào. [HUB-FR-122]

import type { JobSource, JobSourceRead } from "@ai/contracts/hub";
import type { SourceConfig, SourceKind, SourcePin, StageSource } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  checkSourceRefs,
  explainSourceRefs,
  type ManifestItem,
  type RefCheck,
  refCheckMessage,
} from "./sources.rules";

/** Mục nguồn def-level trong `snapshot.sources` (chốt lúc start; `allowlist_union` gộp các stage). */
export type ResolveSource = {
  source_id: string;
  key: string;
  kind: SourceKind;
  config: SourceConfig;
  description: string;
  allowlist_union: string[];
};

/** Ngữ cảnh nguồn của stage hiện tại của run (một truy vấn). */
export type StageSourceCtx = {
  idx: number;
  stageSources: StageSource[];
  defSources: ResolveSource[];
  pinned: SourcePin[] | null;
  /** key → pin (song song `defSources`/`pinned`). */
  pins: Record<string, SourcePin>;
};

function pinByKey(
  defSources: ResolveSource[],
  pinned: SourcePin[] | null,
): Record<string, SourcePin> {
  const map: Record<string, SourcePin> = {};
  if (!pinned) return map;
  defSources.forEach((s, i) => {
    const p = pinned[i];
    if (p) map[s.key] = p;
  });
  return map;
}

export async function loadStageSourceCtx(tx: Tx, runId: string): Promise<StageSourceCtx> {
  const [r] = await tx.execute<{
    idx: number;
    def_sources: unknown;
    stage_sources: unknown;
    pinned: unknown;
  }>(sql`select current_stage_idx as idx,
      coalesce(snapshot->'sources', '[]'::jsonb) as def_sources,
      coalesce(snapshot->'stages'->(current_stage_idx::int)->'sources', '[]'::jsonb) as stage_sources,
      pinned_sources as pinned
    from hub.process_runs where id = ${runId}`);
  const defSources = Array.isArray(r?.def_sources) ? (r.def_sources as ResolveSource[]) : [];
  const stageSources = Array.isArray(r?.stage_sources) ? (r.stage_sources as StageSource[]) : [];
  const pinned = Array.isArray(r?.pinned) ? (r.pinned as SourcePin[]) : null;
  return {
    idx: Number(r?.idx ?? 0),
    stageSources,
    defSources,
    pinned,
    pins: pinByKey(defSources, pinned),
  };
}

/** PB-R10 · `payload.sources` của stage: pin đã ghim + allowlist CỦA STAGE (không phải union). */
export function stageJobSources(c: StageSourceCtx): JobSource[] {
  const byKey = new Map(c.defSources.map((s) => [s.key, s] as const));
  const out: JobSource[] = [];
  for (const ss of c.stageSources) {
    const src = byKey.get(ss.source_key);
    const pin = c.pins[ss.source_key];
    if (!src || !pin) continue;
    out.push({ key: src.key, kind: src.kind, pin, allowlist: [...(ss.allowlist ?? [])] });
  }
  return out;
}

/** MANIFEST: thứ tự theo `stage.sources`; mỗi nguồn {key, description, pin}. */
export function stageManifestItems(c: StageSourceCtx): ManifestItem[] {
  const byKey = new Map(c.defSources.map((s) => [s.key, s] as const));
  const out: ManifestItem[] = [];
  for (const ss of c.stageSources) {
    const src = byKey.get(ss.source_key);
    const pin = c.pins[ss.source_key];
    if (!src || !pin) continue;
    out.push({ key: src.key, description: src.description, pin });
  }
  return out;
}

/**
 * PB-R09/C16 · kiểm `## Nguồn tham chiếu` của output stage: key∈stage, @version khớp pin, path∈files_read (gộp các
 * nguồn; có files_read=null ⇒ bỏ kiểm path). Stage không nguồn ⇒ ok.
 */
export function stageRefsCheck(
  ctx: StageSourceCtx,
  text: string,
  sourceReads: readonly JobSourceRead[] | undefined,
): RefCheck {
  const keys = ctx.stageSources.map((s) => s.source_key);
  if (keys.length === 0) return { ok: true };
  const reads = sourceReads ?? [];
  const anyNull = reads.some((r) => r.files_read === null);
  const filesRead = anyNull ? null : reads.flatMap((r) => r.files_read ?? []);
  return checkSourceRefs(text, keys, ctx.pins, filesRead);
}

/** Như `stageRefsCheck` + `offenders` (feedback). */
export function stageRefsExplain(
  ctx: StageSourceCtx,
  text: string,
  sourceReads: readonly JobSourceRead[] | undefined,
): RefCheck {
  const keys = ctx.stageSources.map((s) => s.source_key);
  if (keys.length === 0) return { ok: true };
  const reads = sourceReads ?? [];
  const anyNull = reads.some((r) => r.files_read === null);
  const filesRead = anyNull ? null : reads.flatMap((r) => r.files_read ?? []);
  return explainSourceRefs(text, keys, ctx.pins, filesRead);
}

/** Feedback lượt sau: mục thiếu + (lỗi nguồn) thông điệp actionable theo reason (offenders). */
export function refsFeedback(
  missing: string[],
  refsOk: boolean,
  ctx: StageSourceCtx | undefined,
  text: string,
  reads: readonly JobSourceRead[] | undefined,
): string {
  if (refsOk || !ctx) return `Thiếu mục: ${missing.join(", ")}`;
  const chk = stageRefsExplain(ctx, text, reads);
  const others = missing.filter((m) => m !== "## Nguồn tham chiếu");
  const head = others.length > 0 ? `Thiếu mục: ${others.join(", ")}. ` : "";
  return chk.ok ? head : head + refCheckMessage(chk, ctx.pins);
}

const filesCol = (files: readonly string[] | null) =>
  files === null
    ? sql`null::text[]`
    : files.length === 0
      ? sql`'{}'::text[]`
      : sql`array[${sql.join(
          files.map((f) => sql`${f}`),
          sql`, `,
        )}]::text[]`;

/**
 * PB-R11 · C18 · ghi `hub.source_job_reads` (append-only) từ `job.result.source_reads`: map `source_key`→`source_id`
 * + pin đã ghim. Scope system (tx truyền vào), lọc theo nguồn def của run. KHÔNG token/credential (pin git không userinfo).
 */
export async function auditSourceReads(
  tx: Tx,
  p: { runId: string; stageRunId: string; jobId: string | null; tenantId: string },
  reads: readonly JobSourceRead[],
  ctx: StageSourceCtx,
): Promise<void> {
  if (!p.jobId || reads.length === 0) return;
  const byKey = new Map(ctx.defSources.map((s) => [s.key, s] as const));
  for (const sr of reads) {
    const src = byKey.get(sr.source_key);
    const pin = ctx.pins[sr.source_key];
    if (!src || !pin) continue;
    await tx.execute(sql`insert into hub.source_job_reads
        (tenant_id, process_run_id, stage_run_id, job_id, source_id, source_key, pin, files_read, bytes_read)
      values (${p.tenantId}, ${p.runId}, ${p.stageRunId}, ${p.jobId}, ${src.source_id}, ${src.key},
        ${JSON.stringify(pin)}::jsonb, ${filesCol(sr.files_read)}, ${sr.bytes_read})`);
  }
}
