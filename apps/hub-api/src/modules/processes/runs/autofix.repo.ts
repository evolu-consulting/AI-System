// HUB-FR-128 · HUB-FR-115 · HUB-FR-127 · PC-R05/R06/R10/R11 · P-c1 · truy vấn tự-sửa của stage-driver (dựng `payload.autofix`,
// kết quả job → "Cần người quyết") và launcher (khối làm lại). Plan §2 query (a)–(c), §6.3–6.4. `hub.autofix_results` RLS "T":
// mọi câu lọc `tenant_id` tường minh (scope system ở driver; scope user người bắt đầu ở launcher — cùng tenant).
import type { DecisionReason } from "@ai/contracts/chat";
import type { JobAttachment, JobAutofix, JobSource } from "@ai/contracts/hub";
import type { AutofixFailure, AutofixStatus } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { autofixJobPart, autofixOutcome, basePatchOf } from "./autofix.rules";
import type { SnapStage } from "./launcher-prompt";
import { loadStageSourceCtx, type StageSourceCtx, stageJobSources } from "./stage-sources";
import { stageRowById } from "./step-persist";

type Key = { stageRunId: string; tenantId: string };

/** (a) diff `ok` mới nhất của stage_run còn trên kho → `JobAttachment` (index `autofix_results_stage_idx`). */
async function latestOkPatch(tx: Tx, k: Key): Promise<JobAttachment | null> {
  const [r] = await tx.execute<{
    id: string;
    filename: string;
    mime: string;
    size: string | number;
    sha256: string;
  }>(sql`select a.id, a.filename, a.mime, a.size, a.sha256 from hub.autofix_results ar
    join hub.attachments a on a.id = ar.diff_attachment_id and a.tenant_id = ar.tenant_id
    where ar.stage_run_id = ${k.stageRunId} and ar.tenant_id = ${k.tenantId} and ar.status = 'ok'
      and a.purged_at is null
    order by ar.created_at desc, ar.id desc limit 1`);
  return r
    ? { id: r.id, name: r.filename, mime: r.mime as never, size: Number(r.size), sha256: r.sha256 }
    : null;
}

/** Kết quả mới nhất của stage_run (mọi status) — cho `basePatchOf` (`apply_patch` ⇒ làm lại từ đầu). */
async function latestResult(
  tx: Tx,
  k: Key,
): Promise<{ status: AutofixStatus; failures: { check: string }[] } | null> {
  const [r] = await tx.execute<{
    status: AutofixStatus;
    failures: unknown;
  }>(sql`select status, failures
    from hub.autofix_results where stage_run_id = ${k.stageRunId} and tenant_id = ${k.tenantId}
    order by created_at desc, id desc limit 1`);
  if (!r) return null;
  return { status: r.status, failures: Array.isArray(r.failures) ? r.failures : [] };
}

/**
 * PC-R05/R11 · `payload.autofix` của job stage (null ⇒ stage thường / chưa ghim nguồn). Vòng = `stage_runs.attempt`;
 * `base_patch` = `basePatchOf(kết quả mới nhất, diff ok mới nhất)`; nguồn ghim từ `pinned_sources` (đã resolve).
 */
export async function autofixJobFor(
  tx: Tx,
  p: Key & { runId: string; srcCtx: StageSourceCtx },
): Promise<JobAutofix | null> {
  const [r] = await tx.execute<{ attempt: number; stage: SnapStage | null }>(sql`select s.attempt,
      r.snapshot->'stages'->(s.stage_idx::int) as stage
    from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
    where s.id = ${p.stageRunId} and s.tenant_id = ${p.tenantId} and r.id = ${p.runId}`);
  const stage = r?.stage;
  if (!r || !stage?.autofix) return null;
  const key = stage.autofix.source_key;
  const src = p.srcCtx.defSources.find((s) => s.key === key);
  const pin = p.srcCtx.pins[key];
  if (!src || !pin) return null;
  const basePatch = basePatchOf(
    await latestResult(tx, p).then((x) => x && { ...x, diffAttachment: null }),
    await latestOkPatch(tx, p),
  );
  return autofixJobPart({
    stage,
    pin,
    kind: src.kind,
    runId: p.runId,
    round: Number(r.attempt),
    basePatch,
  });
}

/**
 * PC-R10 (b)(c) · gọi SAU kiểm ngân sách token: báo cáo theo `job_id` (unique) + lý do lỗi job ⇒ lý do "Cần người quyết"
 * (`sandbox_unavailable` / `autofix_check_failed`) hoặc null (ok/no_changes ⇒ đi tiếp như cũ).
 */
export async function autofixDecision(
  tx: Tx,
  p: { jobId: string | null; tenantId: string; jobReason: string | null },
): Promise<Extract<DecisionReason, "autofix_check_failed" | "sandbox_unavailable"> | null> {
  const [row] = p.jobId
    ? await tx.execute<{ status: AutofixStatus }>(sql`select status from hub.autofix_results
        where job_id = ${p.jobId} and tenant_id = ${p.tenantId}`)
    : [];
  const o = autofixOutcome(row ?? null, p.jobReason);
  return o.kind === "decision" ? o.reason : null;
}

/**
 * PC-R10 · lần chạy trước của stage kết thúc bằng decision `autofix_check_failed` (task decision tạo SAU lần chạy
 * `hub.runs` mới nhất) ⇒ lỗi kiểm của báo cáo lần đó ([] nếu thiếu báo cáo); không ⇒ null (không thêm khối làm lại).
 */
export async function retryFailures(tx: Tx, k: Key): Promise<AutofixFailure[] | null> {
  const [r] = await tx.execute<{ reason: string | null; failures: unknown }>(sql`
    with lr as (select coalesce(max(started_at), '-infinity'::timestamptz) as at from hub.runs
      where stage_run_id = ${k.stageRunId} and tenant_id = ${k.tenantId})
    select (select t.reason from hub.review_tasks t, lr where t.stage_run_id = ${k.stageRunId}
        and t.tenant_id = ${k.tenantId} and t.kind = 'decision' and t.created_at > lr.at
        order by t.created_at desc limit 1) as reason,
      (select ar.failures from hub.autofix_results ar, lr where ar.stage_run_id = ${k.stageRunId}
        and ar.tenant_id = ${k.tenantId} and ar.created_at > lr.at
        order by ar.created_at desc limit 1) as failures`);
  if (r?.reason !== "autofix_check_failed") return null;
  return Array.isArray(r.failures) ? (r.failures as AutofixFailure[]) : [];
}

/**
 * PB-R10 · nguồn đã ghim của stage → `sources` (ép Read/Grep/Glob ở runner.rules); vắng ⇒ như P-a. P-c1 · PC-R05/R11 · stage
 * tự-sửa ⇒ `autofix` (nguồn ghim, vòng = attempt, base_patch). Tx scope system; mọi câu lọc `tenant_id` của run.
 */
export async function stageJobExtras(
  tx: Tx,
  link: { process_run_id: string | null; stage_run_id: string | null; tenant_id: string },
): Promise<{ sources?: JobSource[]; autofix?: JobAutofix }> {
  const pr = link.process_run_id as string;
  const sr = link.stage_run_id as string;
  const st = await stageRowById(tx, pr, sr, link.tenant_id);
  const srcCtx = await loadStageSourceCtx(tx, pr, st?.stage_idx ?? 0);
  const autofix = await autofixJobFor(tx, {
    runId: pr,
    stageRunId: sr,
    tenantId: link.tenant_id,
    srcCtx,
  });
  const sources = stageJobSources(srcCtx);
  return { ...(sources.length ? { sources } : {}), ...(autofix ? { autofix } : {}) };
}
