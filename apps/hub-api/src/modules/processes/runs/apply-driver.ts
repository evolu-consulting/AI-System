// HUB-FR-129 · HUB-FR-130 · PC2-R07 · PC2-R08 · PC2-R13 · PC2-R16 · P-c2 · plan §6.4, §6.6, C13, C14, C20–C21, C27–C33 ·
// driver stage Áp: sau job `source.apply` (báo cáo `apply-result` + kết thúc job), `advanceApply` đọc hàng
// `autofix_applies` ⇒ `applyOutcome` ⇒ (pushed, không push_only) mở PR qua `github-client` (NGOÀI tx, token bọc
// `useSecret`) rồi UPDATE hàng + output `apply.md` + stage done; hoặc "Cần người quyết" `apply_*`. Chạy từ `sweeps`
// (job kết thúc mà stage còn running). Tx khoá `process_runs` + kiểm lại trạng thái; cách ly tenant (lọc `tenant_id`).
import type { DecisionReason, ProcessRunStatus } from "@ai/contracts/chat";
import {
  type ApplyErrorCode,
  type ApplyMode,
  type ApplyStatus,
  gitProviderOf,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import { type ApplySettle, type SettleOut, settleApply } from "../adapters/runs/hub-settle";
import * as core from "../core/core.repo";
import type { ProcessDeps } from "../core/ports";
import { isTerminal } from "../domain/runs/run-state.rules";
import {
  type ApplyOutputInput,
  applyOutcome,
  applyOutputMd,
  githubRepoOf,
  prBody,
  prTitle,
} from "./apply.rules";
import {
  type ApplyStage,
  credentialIdOf,
  fixContext,
  type LoadedHead,
  loadHead,
} from "./apply-settle";
import { type GithubEndpoint, type OpenPrResult, openPullRequest } from "./github-client";
import { stageRowById } from "./step-persist";
import type { SnapStage } from "./team-runner";

type Deps = Omit<ProcessDeps, "start">;
const SYSTEM = { kind: "system" } as const;

/** Hàng `autofix_applies` cần cho driver (cột đã GRANT đọc/ghi). */
type ApplyRow = {
  id: string;
  status: ApplyStatus;
  error_code: ApplyErrorCode | null;
  mode: ApplyMode;
  branch: string | null;
  pin_sha: string | null;
  target_sha: string | null;
  head_sha: string | null;
  rebased: boolean;
  source_key: string;
  autofix_result_id: string | null;
};

type ApplyJobRow = {
  id: string;
  status: string;
  error_reason: string | null;
  payload: {
    push_only: boolean;
    apply_mode: ApplyMode;
    branch: string;
    pin_sha: string;
    source: {
      source_id: string;
      key: string;
      url: string;
      branch: string;
      has_credential: boolean;
    };
  };
};

/** Hàng Áp của job (unique `job_id`); null ⇒ chưa báo cáo. */
async function applyRowOf(tx: Tx, tenantId: string, jobId: string): Promise<ApplyRow | null> {
  const [r] = await tx.execute<ApplyRow>(sql`select id, status, error_code, mode, branch, pin_sha,
      target_sha, head_sha, rebased, source_key, autofix_result_id
    from hub.autofix_applies where job_id = ${jobId} and tenant_id = ${tenantId}`);
  return r ?? null;
}

/** Job `source.apply` mới nhất của stage (step_id = stage_run_id). */
async function latestApplyJob(
  tx: Tx,
  tenantId: string,
  stageRunId: string,
): Promise<ApplyJobRow | null> {
  const [r] = await tx.execute<ApplyJobRow>(sql`select id, status, error_reason, payload
    from hub.jobs where step_id = ${stageRunId} and type = 'source.apply' and tenant_id = ${tenantId}
    order by created_at desc, id desc limit 1`);
  return r ?? null;
}

const ended = (status: string): boolean => status !== "queued" && status !== "running";

type ProviderPlan = {
  rowId: string;
  tenantId: string;
  sourceId: string;
  credId: string;
  endpoint: GithubEndpoint;
  repo: { owner: string; repo: string };
  branch: string;
  base: string;
  title: string;
  body: string;
  autoMerge: boolean;
  stage: ApplyStage;
  head: LoadedHead;
};

/** Build input markdown cho `applyOutputMd` từ hàng + kết quả PR. */
function mdOf(row: ApplyRow, over: Partial<ApplyOutputInput>): string {
  return applyOutputMd({
    mode: row.mode,
    status: over.status ?? row.status,
    branch: row.branch,
    head_sha: row.head_sha,
    target_sha: row.target_sha,
    rebased: row.rebased,
    pr_url: over.pr_url ?? null,
    pr_number: over.pr_number ?? null,
    auto_merge: over.auto_merge ?? null,
  });
}

/** C14/C27/C33 · job kết thúc không có hàng ⇒ ghi hàng `failed`+`provider_error` (nguồn/nhánh/pin từ payload). */
async function insertFailedRow(
  tx: Tx,
  head: LoadedHead,
  stage: ApplyStage,
  job: ApplyJobRow,
): Promise<void> {
  await tx.execute(sql`insert into hub.autofix_applies (tenant_id, process_run_id, stage_run_id, job_id,
      source_key, mode, status, branch, pin_sha, error_code)
    values (${head.tenant_id}, ${head.id}, ${stage.id}, ${job.id}, ${job.payload.source.key},
      ${job.payload.apply_mode}, 'failed', ${job.payload.branch}, ${job.payload.pin_sha}, 'provider_error')`);
}

/** UPDATE hàng Áp (chỉ cột đã GRANT UPDATE). */
async function updateApplyRow(
  tx: Tx,
  tenantId: string,
  rowId: string,
  set: {
    status: ApplyStatus;
    errorCode: ApplyErrorCode | null;
    provider?: "github" | null;
    prNumber?: number | null;
    prUrl?: string | null;
    autoMerge?: "on" | "failed" | null;
  },
): Promise<void> {
  await tx.execute(sql`update hub.autofix_applies set status = ${set.status}, error_code = ${set.errorCode},
      provider = ${set.provider ?? null}, pr_number = ${set.prNumber ?? null}, pr_url = ${set.prUrl ?? null},
      auto_merge = ${set.autoMerge ?? null}, updated_at = now()
    where id = ${rowId} and tenant_id = ${tenantId}`);
}

type Decided =
  | { kind: "none" }
  | ({ kind: "settled" } & SettleOut)
  | { kind: "provider"; plan: ProviderPlan; row: ApplyRow };

const APPLY_FAILED: ApplySettle = { kind: "decision", reason: "apply_failed" };

/** Giải quyết tại chỗ (không provider): failed+error_code ⇒ decision apply_failed. */
async function failInPlace(
  d: Deps,
  tx: Tx,
  ctx: { head: LoadedHead; stage: ApplyStage; row: ApplyRow },
  code: ApplyErrorCode,
): Promise<Decided> {
  await updateApplyRow(tx, ctx.head.tenant_id, ctx.row.id, { status: "failed", errorCode: code });
  const md = mdOf(ctx.row, { status: "failed" });
  const s = await settleApply(d, tx, {
    head: ctx.head,
    stage: ctx.stage,
    md,
    outcome: APPLY_FAILED,
  });
  return { kind: "settled", ...s };
}

/** Phase 1 (tx): khoá run, đọc hàng + job ⇒ quyết định (settle tại chỗ / cần gọi provider). */
async function decide(d: Deps, tx: Tx, runId: string, stageRunId: string): Promise<Decided> {
  const head0 = await loadHead(tx, runId);
  if (!head0 || !(await core.lockRun(tx, head0.tenant_id, runId))) return { kind: "none" };
  const head = await loadHead(tx, runId);
  if (!head || isTerminal(head.status as ProcessRunStatus)) return { kind: "none" };
  const sr = await stageRowById(tx, runId, stageRunId, head.tenant_id);
  if (sr?.status !== "running") return { kind: "none" };
  const def = head.snapshot.stages[sr.stage_idx] as SnapStage | undefined;
  if (def?.executor.kind !== "apply") return { kind: "none" };
  const job = await latestApplyJob(tx, head.tenant_id, stageRunId);
  if (!job) return { kind: "none" };
  const stage: ApplyStage = {
    id: sr.id,
    stage_idx: sr.stage_idx,
    status: sr.status,
    attempt: Number(sr.attempt),
  };
  const pushOnly = job.payload.push_only === true;
  const row = await applyRowOf(tx, head.tenant_id, job.id);
  if (!row) return decideNoRow(d, tx, { head, stage, job, pushOnly });
  const outcome = applyOutcome(
    { status: row.status, code: row.error_code },
    job.error_reason,
    pushOnly,
  );
  if (outcome.kind === "provider") return decideProvider(d, tx, { head, stage, row, job });
  const settle: ApplySettle =
    outcome.kind === "done" ? { kind: "done" } : { kind: "decision", reason: outcome.reason };
  const s = await settleApply(d, tx, { head, stage, md: mdOf(row, {}), outcome: settle });
  return { kind: "settled", ...s };
}

/** C14/C33 · job kết thúc không có hàng ⇒ ghi failed+provider_error + "Cần người quyết" (container ⇒ sandbox). */
async function decideNoRow(
  d: Deps,
  tx: Tx,
  p: { head: LoadedHead; stage: ApplyStage; job: ApplyJobRow; pushOnly: boolean },
): Promise<Decided> {
  if (!ended(p.job.status)) return { kind: "none" };
  const outcome = applyOutcome(null, p.job.error_reason, p.pushOnly);
  await insertFailedRow(tx, p.head, p.stage, p.job);
  const reason: DecisionReason = outcome.kind === "decision" ? outcome.reason : "apply_failed";
  const md = applyOutputMd({
    mode: p.job.payload.apply_mode,
    status: "failed",
    branch: p.job.payload.branch,
    head_sha: null,
    target_sha: null,
    rebased: false,
    pr_url: null,
    pr_number: null,
    auto_merge: null,
  });
  const s = await settleApply(d, tx, {
    head: p.head,
    stage: p.stage,
    md,
    outcome: { kind: "decision", reason },
  });
  return { kind: "settled", ...s };
}

/** PC2-R07 · hàng `pushed`, không push_only ⇒ chuẩn bị mở PR (hoặc fail tại chỗ: provider null / không khoá / seam vắng). */
async function decideProvider(
  d: Deps,
  tx: Tx,
  ctx: { head: LoadedHead; stage: ApplyStage; row: ApplyRow; job: ApplyJobRow },
): Promise<Decided> {
  const { head, row, job } = ctx;
  const repo = githubRepoOf(job.payload.source.url);
  if (!repo || gitProviderOf(job.payload.source.url) === null)
    return failInPlace(d, tx, ctx, "unsupported_provider"); // C29
  if (!job.payload.source.has_credential) return failInPlace(d, tx, ctx, "no_credential"); // G07
  if (!d.github || !d.secrets) return failInPlace(d, tx, ctx, "provider_error"); // fail-closed (seam vắng)
  const credId = await credentialIdOf(tx, head.tenant_id, job.payload.source.source_id);
  if (!credId) return failInPlace(d, tx, ctx, "no_credential");
  const fix = await fixContext(tx, head, row.autofix_result_id);
  const name = (head.snapshot as unknown as { name?: string }).name ?? "";
  const plan: ProviderPlan = {
    rowId: row.id,
    tenantId: head.tenant_id,
    sourceId: job.payload.source.source_id,
    credId,
    endpoint: d.github,
    repo,
    branch: job.payload.branch,
    base: job.payload.source.branch,
    title: prTitle(name, fix.name, head.id),
    body: prBody(fix.output, head.id, fix.round),
    autoMerge: job.payload.apply_mode === "auto_merge",
    stage: ctx.stage,
    head,
  };
  return { kind: "provider", plan, row };
}

/** PC2-R07 · mở PR NGOÀI tx; token khoá nguồn chỉ sống trong callback `useSecret`. Khoá hỏng ⇒ `no_credential`. */
async function openPr(d: Deps, plan: ProviderPlan): Promise<OpenPrResult> {
  if (!d.secrets) return { kind: "fail", code: "no_credential" };
  try {
    return await d.secrets.useSecret(
      { id: plan.credId, kind: "source_credential", tenantId: plan.tenantId },
      (token) =>
        openPullRequest({
          endpoint: plan.endpoint,
          repo: plan.repo,
          branch: plan.branch,
          base: plan.base,
          title: plan.title,
          body: plan.body,
          autoMerge: plan.autoMerge,
          token,
        }),
    );
  } catch {
    return { kind: "fail", code: "no_credential" };
  }
}

/** Phase 2 (tx): UPDATE hàng theo kết quả PR + chuyển trạng thái; run/stage huỷ giữa chừng ⇒ chỉ lưu hàng (C21). */
async function applyProviderResult(
  d: Deps,
  tx: Tx,
  p: { plan: ProviderPlan; row: ApplyRow; result: OpenPrResult },
): Promise<SettleOut | null> {
  const { plan, row, result } = p;
  const runId = plan.head.id;
  const head0 = await loadHead(tx, runId);
  if (!head0 || !(await core.lockRun(tx, plan.tenantId, runId))) {
    await writeResultRow(tx, plan, result);
    return null;
  }
  const head = await loadHead(tx, runId);
  const sr = await stageRowById(tx, runId, plan.stage.id, plan.tenantId);
  await writeResultRow(tx, plan, result);
  if (!head || isTerminal(head.status as ProcessRunStatus) || !sr || sr.status !== "running")
    return null;
  const stage: ApplyStage = {
    id: sr.id,
    stage_idx: sr.stage_idx,
    status: sr.status,
    attempt: Number(sr.attempt),
  };
  if (result.kind === "fail") {
    const md = mdOf(row, { status: "failed" });
    return settleApply(d, tx, { head, stage, md, outcome: APPLY_FAILED });
  }
  const md = mdOf(row, {
    status: "pr_opened",
    pr_url: result.prUrl,
    pr_number: result.prNumber,
    auto_merge: result.autoMerge,
  });
  return settleApply(d, tx, { head, stage, md, outcome: { kind: "done" } });
}

/** UPDATE hàng Áp theo `OpenPrResult` (luôn làm, kể cả run huỷ — chỉ cột đã GRANT). */
function writeResultRow(tx: Tx, plan: ProviderPlan, result: OpenPrResult): Promise<unknown> {
  if (result.kind === "fail")
    return updateApplyRow(tx, plan.tenantId, plan.rowId, {
      status: "failed",
      errorCode: result.code,
      provider: null,
    });
  return updateApplyRow(tx, plan.tenantId, plan.rowId, {
    status: "pr_opened",
    errorCode: result.invalidUrl ? "provider_error" : null,
    provider: "github",
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    autoMerge: result.autoMerge,
  });
}

/** Sau COMMIT: phát sự kiện + đăng thread + kick bước kế. */
async function publish(d: Deps, runId: string, out: SettleOut): Promise<void> {
  await publishUserEvents(d.redis, out.events, d.log);
  await d.postThread(runId).catch(() => {});
  if (out.kick) await d.launcher.kick(runId).catch(() => {});
}

/**
 * HUB-FR-129 · PC2-R07/R08 · tiến stage Áp sau khi job `source.apply` báo cáo/kết thúc: quyết định (tx) → (nếu cần) mở PR
 * (ngoài tx) → UPDATE + chuyển trạng thái (tx). Idempotent: stage không còn `running` ⇒ bỏ. Gọi từ `sweeps`.
 */
export async function advanceApply(
  d: Deps,
  p: { runId: string; stageRunId: string },
): Promise<void> {
  try {
    const dec = await withHubScope(d.db, SYSTEM, (tx) => decide(d, tx, p.runId, p.stageRunId));
    if (dec.kind === "none") return;
    if (dec.kind === "settled") return void (await publish(d, p.runId, dec));
    const result = await openPr(d, dec.plan);
    const out = await withHubScope(d.db, SYSTEM, (tx) =>
      applyProviderResult(d, tx, { plan: dec.plan, row: dec.row, result }),
    );
    if (out) await publish(d, p.runId, out);
  } catch (err) {
    d.log.error("apply-advance-failed", { run_id: p.runId, ...safeErrorFields(err) });
  }
}
