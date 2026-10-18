// HUB-FR-129 · HUB-FR-130 · PC2-R03 · PC2-R13 · PC2-R16 · P-c2 · plan §6.2, C20, C32, C45 · launcher stage Áp (executor
// `apply`): audit `authorize_real_action` (actor = người Đạt cổng tự-sửa, agent_id null — C32) → đọc kết quả tự-sửa bước
// trước + nguồn HIỆN TẠI → `applyPlan`: `git_remote` ⇒ job `source.apply` (stage running, `step_id`=stage_run_id);
// `no_changes`/`branch_only`(local)/`invalid` ⇒ hàng `autofix_applies` + output `apply.md` + done/decision (không job).
// Nguồn xoá / url≠pin / đổi kind ⇒ `invalid` (failed+provider_error — C20/C45). Chạy TRONG tx khoá run của launcher.
import type { JobAttachment } from "@ai/contracts/hub";
import {
  type ApplyMode,
  type AutofixStatus,
  effectiveApplyMode,
  type SourceKind,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../lib/user-stream";
import { type ApplySettle, settleApply } from "../adapters/runs/hub-settle";
import type { ProcessDeps } from "../core/ports";
import { type ApplyPlanResult, applyOutputMd, applyPlan } from "./apply.rules";
import { type ApplyStage, loadHead } from "./apply-settle";
import type { Head, SnapStage } from "./launcher-prompt";
import { auditRealAction, realActionPre } from "./launcher-step";

type Deps = Omit<ProcessDeps, "launcher" | "start">;
/** Chỉ hai nhánh khả dĩ của stage Áp (job ⇒ không phát gì; không job ⇒ phát sự kiện settle). */
export type ApplyLaunchResult = { kind: "skip" } | { kind: "events"; events: UserEvent[] };

type LaunchCtx = {
  runId: string;
  idx: number;
  head: Head;
  stage: { id: string; attempt: number };
  def: SnapStage;
};

type SourceConfig = {
  kind: SourceKind;
  url?: string;
  branch?: string;
  credential_secret_id?: string | null;
  apply_mode?: "pr" | "auto_merge" | "branch_only";
};
type FixRow = {
  status: string;
  source_key: string;
  branch: string;
  pin: { kind?: string; sha?: string; url?: string } | null;
  d_id: string | null;
  d_name: string | null;
  d_mime: string | null;
  d_size: string | number | null;
  d_sha: string | null;
};

/** PC2-R13 · audit `authorize_real_action` (actor = người Đạt cổng tự-sửa; agent_id null — C32). */
async function auditApply(d: Deps, tx: Tx, c: LaunchCtx): Promise<void> {
  const real = await realActionPre(d, tx, {
    runId: c.runId,
    tenantId: c.head.tenant_id,
    idx: c.idx,
    def: c.def,
    stages: c.head.snapshot.stages,
  });
  if (!real) return;
  await auditRealAction(tx, {
    tenantId: c.head.tenant_id,
    runId: c.runId,
    actorId: real.passedBy,
    name: c.def.name,
    agentId: null,
    pre: real,
  });
}

/** Kết quả tự-sửa đã duyệt của stage tự-sửa (fixIdx) + file diff. */
async function fixResult(tx: Tx, c: LaunchCtx, fixIdx: number): Promise<FixRow | null> {
  const [r] = await tx.execute<FixRow>(sql`select ar.status, ar.source_key, ar.branch, ar.pin,
      a.id as d_id, a.filename as d_name, a.mime as d_mime, a.size as d_size, a.sha256 as d_sha
    from hub.autofix_results ar
    join hub.stage_runs s on s.id = ar.stage_run_id and s.tenant_id = ar.tenant_id
    left join hub.attachments a on a.id = ar.diff_attachment_id and a.tenant_id = ar.tenant_id and a.purged_at is null
    where ar.process_run_id = ${c.runId} and ar.tenant_id = ${c.head.tenant_id} and s.stage_idx = ${fixIdx}
    order by ar.created_at desc, ar.id desc limit 1`);
  return r ?? null;
}

async function sourceByKey(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<{ id: string; config: SourceConfig } | null> {
  const [r] = await tx.execute<{ id: string; config: SourceConfig }>(sql`select id, config
    from hub.sources where key = ${key} and tenant_id = ${tenantId} and deleted_at is null`);
  return r ?? null;
}

const pinSha = (pin: FixRow["pin"]): string | null =>
  pin?.kind === "git_remote" && typeof pin.sha === "string" ? pin.sha : null;

/** C20 · nguồn không còn khớp pin (xoá / đổi url / đổi kind) ⇒ Áp không hợp lệ. */
function sourceMismatch(src: { config: SourceConfig } | null, pin: FixRow["pin"]): boolean {
  if (!src) return true;
  if (pin?.kind === "git_remote")
    return src.config.kind !== "git_remote" || src.config.url !== pin.url;
  return false;
}

const APPLY_FAILED: ApplySettle = { kind: "decision", reason: "apply_failed" };

type NoJob = {
  status: "no_changes" | "branch_only" | "failed";
  errorCode: "provider_error" | null;
  mode: ApplyMode;
  sourceKey: string;
  outcome: ApplySettle;
};

/** Hàng `autofix_applies` không job (job_id null; branch/pin null — không push) + output + chuyển trạng thái. */
async function noJob(d: Deps, tx: Tx, c: LaunchCtx, p: NoJob): Promise<ApplyLaunchResult> {
  await tx.execute(sql`insert into hub.autofix_applies (tenant_id, process_run_id, stage_run_id,
      source_key, mode, status, error_code)
    values (${c.head.tenant_id}, ${c.runId}, ${c.stage.id}, ${p.sourceKey}, ${p.mode}, ${p.status},
      ${p.errorCode})`);
  const md = applyOutputMd({
    mode: p.mode,
    status: p.status,
    branch: null,
    head_sha: null,
    target_sha: null,
    rebased: false,
    pr_url: null,
    pr_number: null,
    auto_merge: null,
  });
  const lhead = await loadHead(tx, c.runId);
  if (!lhead) return { kind: "skip" };
  const stage: ApplyStage = {
    id: c.stage.id,
    stage_idx: c.idx,
    status: "queued",
    attempt: c.stage.attempt,
  };
  const s = await settleApply(d, tx, { head: lhead, stage, md, outcome: p.outcome });
  return { kind: "events", events: s.events };
}

type JobInput = {
  src: { id: string; config: SourceConfig };
  fix: FixRow;
  af: NonNullable<SnapStage["autofix"]>;
  mode: ApplyMode;
  diff: { id: string; name: string; mime: string; size: number; sha256: string };
};

/** PC2-R03 · job `source.apply` (stage running; `step_id`=stage_run_id để kênh nội bộ gắn run/stage — không hub.runs). */
async function launchJob(tx: Tx, c: LaunchCtx, p: JobInput): Promise<ApplyLaunchResult> {
  const jobId = crypto.randomUUID();
  const payload = {
    v: 1,
    type: "source.apply",
    job_id: jobId,
    tenant_id: c.head.tenant_id,
    process_run_id: c.runId,
    source: {
      source_id: p.src.id,
      key: p.fix.source_key,
      url: p.src.config.url,
      branch: p.src.config.branch,
      has_credential: Boolean(p.src.config.credential_secret_id),
    },
    pin_sha: pinSha(p.fix.pin),
    branch: p.fix.branch,
    apply_mode: p.mode,
    push_only: p.mode === "branch_only",
    patch: {
      id: p.diff.id,
      name: p.diff.name,
      mime: p.diff.mime,
      size: p.diff.size,
      sha256: p.diff.sha256,
    },
    install_cmd: p.af.install_cmd ?? null,
    test_cmd: p.af.test_cmd,
    write_allowlist: [...(p.af.write_allowlist ?? [])],
    timeout_s: c.def.timeout_s,
  };
  await tx.execute(sql`insert into hub.jobs (id, tenant_id, user_id, type, payload, status, step_id)
    values (${jobId}, ${c.head.tenant_id}, ${c.head.started_by}, 'source.apply',
      ${JSON.stringify(payload)}::jsonb, 'queued', ${c.stage.id})`);
  await tx.execute(sql`update hub.stage_runs set status = 'running',
      started_at = coalesce(started_at, now()), updated_at = now()
    where id = ${c.stage.id} and tenant_id = ${c.head.tenant_id}`);
  return { kind: "skip" };
}

/**
 * PC2-R03/R13 · launcher stage Áp: audit → kết quả tự-sửa + nguồn hiện tại → `applyPlan`. `job` ⇒ enqueue
 * `source.apply`; còn lại ⇒ hàng + output + done/decision (không job). Chạy TRONG tx khoá run của launcher.
 */
/** `JobAttachment` của diff đã duyệt (thiếu id/sha ⇒ null ⇒ `applyPlan` coi là invalid). */
function diffOf(fix: FixRow | null): JobAttachment | null {
  if (!fix?.d_id || !fix.d_name || !fix.d_sha) return null;
  return {
    id: fix.d_id,
    name: fix.d_name,
    mime: (fix.d_mime ?? "text/plain") as JobAttachment["mime"],
    size: Number(fix.d_size),
    sha256: fix.d_sha,
  };
}

/** Tham số hàng không-job theo `applyPlan.kind` (no_changes/branch_only ⇒ done; còn lại ⇒ invalid). */
function noJobParams(kind: string, mode: ApplyMode, sourceKey: string, invalid: NoJob): NoJob {
  if (kind === "no_changes")
    return { status: "no_changes", errorCode: null, mode, sourceKey, outcome: { kind: "done" } };
  if (kind === "branch_only")
    return { status: "branch_only", errorCode: null, mode, sourceKey, outcome: { kind: "done" } };
  return invalid;
}

export async function launchApplyStage(d: Deps, tx: Tx, c: LaunchCtx): Promise<ApplyLaunchResult> {
  await auditApply(d, tx, c);
  const stages = c.head.snapshot.stages;
  const fixIdx = stages.findIndex((s) => s.autofix);
  const fixStage = fixIdx >= 0 ? stages[fixIdx] : undefined;
  const fix = fixIdx >= 0 ? await fixResult(tx, c, fixIdx) : null;
  const sourceKey = fix?.source_key ?? fixStage?.autofix?.source_key ?? "";
  const src = sourceKey ? await sourceByKey(tx, c.head.tenant_id, sourceKey) : null;
  const mode = src ? effectiveApplyMode(src.config) : "branch_only";
  const diff = diffOf(fix);
  const invalid: NoJob = {
    status: "failed",
    errorCode: "provider_error",
    mode,
    sourceKey,
    outcome: APPLY_FAILED,
  };
  if (fix?.status === "ok" && diff && sourceMismatch(src, fix.pin)) return noJob(d, tx, c, invalid); // C20
  const result: ApplyPlanResult = fix ? { status: fix.status as AutofixStatus, diff } : null;
  const plan = applyPlan({
    result,
    sourceKind: (src?.config.kind ?? "git_remote") as SourceKind,
    mode,
  });
  if (plan.kind === "job" && src && fix && fixStage?.autofix && diff)
    return launchJob(tx, c, { src, fix, af: fixStage.autofix, mode, diff });
  return noJob(d, tx, c, noJobParams(plan.kind, mode, sourceKey, invalid));
}
