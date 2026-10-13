// HUB-FR-136 (SHOULD) · R10–R12 · AC-PB2-09/10 · plan §4.1–§4.2 (D11): prompt stage = khối Bàn giao của các bước trước
// (đọc `process_outputs.content`) + quyết định session Claude (`sessionPlan`) — resume chỉ do Hub điều khiển: `use_session`
// trong payload + xoá `hub.cli_sessions` trước job "chạy mới". Chạy trong tx kick (scope user người bắt đầu, run đã khoá).
// `hub.cli_sessions` không RLS ⇒ mọi câu lọc `tenant_id` tường minh.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ConfigSnapshot } from "../../config/config.rules";
import { priorStageIdxs } from "../core/step.rules";
import { retryFailures } from "./autofix.repo";
import { autofixRetryBlock, autofixWorkspaceBlock } from "./autofix.rules";
import { askHistoryBlock, type HandoffItem, handoffBlock, handoffOf } from "./handoff.rules";
import { type Head, hasKhSummaryTarget, promptOf, type SnapStage } from "./launcher-prompt";
import {
  deltaPrompt,
  SESSION_RESUME_MAX_AGE_S,
  type SessionCtx,
  sessionPlan,
} from "./session.rules";
import { stepsOfSnap } from "./step-persist";

/** Hàng `stage_runs` launcher cần cho prompt/session. */
export type SessionStage = {
  id: string;
  attempt: number;
  round: number;
  feedback: string | null;
  redo_sections: string[] | null;
};

export type StagePromptInput = {
  tenantId: string;
  runId: string;
  idx: number;
  head: Head;
  stage: SessionStage;
  def: SnapStage;
};

/** `content` = prompt job; `useSession` → `payload.use_session` (stage agent). */
export type StagePrompt = { content: string; useSession: boolean };

const ASK_HISTORY_MAX = 3;

const idList = (xs: readonly number[]) =>
  sql.join(
    xs.map((i) => sql`${i}`),
    sql`, `,
  );

/** R10 · Bàn giao của output đã chốt các stage bước trước (`### <tên> (s<idx>-v<ver>-<file>)`); không mục ⇒ bỏ. */
async function handoffItems(tx: Tx, c: StagePromptInput): Promise<HandoffItem[]> {
  const stages = c.head.snapshot.stages;
  const prior = priorStageIdxs(stepsOfSnap({ stages }), c.idx);
  if (prior.length === 0) return [];
  const rows = await tx.execute<{ stage_idx: number; version: number; content: string }>(sql`
    select o.stage_idx, o.version, o.content from hub.stage_runs s
    join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
    where s.process_run_id = ${c.runId} and s.tenant_id = ${c.tenantId}
      and s.stage_idx in (${idList(prior)}) order by o.stage_idx`);
  return [...rows].map((r) => {
    const i = Number(r.stage_idx);
    const st = stages[i];
    return {
      name: st?.name ?? `#${i}`,
      file: `s${i}-v${Number(r.version)}-${st?.output.filename ?? "output.md"}`,
      handoff: handoffOf(r.content),
    };
  });
}

/** Ask đã trả lời của lần làm hiện tại (sau output gần nhất của stage), cũ → mới, ≤ 3. */
async function askHistory(tx: Tx, c: StagePromptInput): Promise<string | null> {
  const rows = await tx.execute<{ question: string | null; answer: string | null }>(sql`
    select t.question, t.answer from hub.review_tasks t
    where t.stage_run_id = ${c.stage.id} and t.tenant_id = ${c.tenantId}
      and t.kind = 'ask' and t.result = 'answer'
      and t.created_at > coalesce((select max(o.created_at) from hub.process_outputs o
        where o.stage_run_id = ${c.stage.id} and o.tenant_id = ${c.tenantId}), '-infinity')
    order by t.decided_at desc limit ${ASK_HISTORY_MAX}`);
  const qa = [...rows]
    .reverse()
    .map((r) => ({ question: r.question ?? "", answer: r.answer ?? "" }))
    .filter((r) => r.answer.length > 0);
  return askHistoryBlock(qa);
}

/** `continuing` = có ask `answer` của stage quyết SAU lần chạy (`hub.runs`) mới nhất của stage (RR-11). */
async function isContinuing(tx: Tx, c: StagePromptInput): Promise<boolean> {
  const [r] = await tx.execute<{ ok: boolean }>(sql`select exists (
      select 1 from hub.review_tasks t where t.stage_run_id = ${c.stage.id} and t.tenant_id = ${c.tenantId}
        and t.kind = 'ask' and t.result = 'answer'
        and t.decided_at > coalesce((select max(r.started_at) from hub.runs r
          where r.stage_run_id = ${c.stage.id} and r.tenant_id = ${c.tenantId}), '-infinity')
    ) as ok`);
  return r?.ok === true;
}

/** Lần chạy `finished` mới nhất của agent trong run (không tính nhóm) là chính stage này. */
async function lastWriterIsSelf(tx: Tx, c: StagePromptInput, agentId: string): Promise<boolean> {
  const [r] = await tx.execute<{ stage_run_id: string }>(sql`select stage_run_id from hub.runs
    where process_run_id = ${c.runId} and tenant_id = ${c.tenantId} and agent_id = ${agentId}
      and team_run_id is null and status = 'finished'
    order by finished_at desc nulls last limit 1`);
  return r?.stage_run_id === c.stage.id;
}

/** Provider bước đầu profile của agent (khoá `cli_sessions` của Runtime); không tra được ⇒ null. */
function providerOf(snap: ConfigSnapshot | null, agentId: string): string | null {
  const agent = snap?.agents.find((a) => a.id === agentId);
  const profile = snap?.profiles.find((p) => p.id === agent?.profileId);
  return profile?.steps[0]?.provider_key ?? null;
}

/** G-7 · có session (hội thoại nền, agent, provider) tuổi ≤ 86 400 s (so theo giây nguyên). */
async function sessionExists(
  tx: Tx,
  c: StagePromptInput,
  k: { agentId: string; provider: string | null },
): Promise<boolean> {
  if (!k.provider) return false;
  const [r] = await tx.execute<{ fresh: boolean }>(sql`select
      floor(extract(epoch from (now() - updated_at))) <= ${SESSION_RESUME_MAX_AGE_S} as fresh
    from hub.cli_sessions where conversation_id = ${c.head.conversation_id} and agent_id = ${k.agentId}
      and provider_key = ${k.provider} and tenant_id = ${c.tenantId}`);
  return r?.fresh === true;
}

/** `sameAgentInStep` (tĩnh, snapshot): stage khác cùng bước dùng cùng agent. */
function sameAgentInStep(c: StagePromptInput, agentId: string): boolean {
  const stages = c.head.snapshot.stages;
  const steps = stepsOfSnap({ stages });
  return stages.some(
    (s, i) =>
      i !== c.idx &&
      steps[i] === steps[c.idx] &&
      s.executor.kind === "agent" &&
      s.executor.agent_id === agentId,
  );
}

const NO_AGENT = { sameAgentInStep: false, lastWriterIsSelf: false, sessionExists: false };

async function sessionCtx(
  tx: Tx,
  c: StagePromptInput,
  snap: ConfigSnapshot | null,
): Promise<SessionCtx> {
  const continuing = await isContinuing(tx, c);
  const rerun = Number(c.stage.attempt) > 1 || Number(c.stage.round) > 1;
  if (c.def.executor.kind !== "agent") return { ...NO_AGENT, executor: "team", rerun, continuing };
  const agentId = c.def.executor.agent_id;
  return {
    executor: "agent",
    rerun,
    continuing,
    sameAgentInStep: sameAgentInStep(c, agentId),
    lastWriterIsSelf: await lastWriterIsSelf(tx, c, agentId),
    sessionExists: await sessionExists(tx, c, { agentId, provider: providerOf(snap, agentId) }),
  };
}

/**
 * Prompt + session của job stage. resume ∧ ¬continuing ∧ có góp ý ⇒ `deltaPrompt`; ngược lại prompt đầy đủ (+ Bàn giao).
 * Tiếp sau trả lời ⇒ nối "Câu hỏi trước/Trả lời" (≤ 3). `clearSession` ⇒ xoá `cli_sessions` (hội thoại nền, agent).
 */
export async function stagePrompt(
  tx: Tx,
  c: StagePromptInput,
  snap: ConfigSnapshot | null,
): Promise<StagePrompt> {
  const ctx = await sessionCtx(tx, c, snap);
  const plan = sessionPlan(ctx);
  if (plan.clearSession && c.def.executor.kind === "agent")
    await tx.execute(sql`delete from hub.cli_sessions where conversation_id = ${c.head.conversation_id}
      and agent_id = ${c.def.executor.agent_id} and tenant_id = ${c.tenantId}`);
  const fb = c.stage.feedback?.trim() ?? "";
  const retry = await autofixRetry(tx, c);
  if (plan.resume && !ctx.continuing && fb.length > 0) {
    const delta = deltaPrompt(fb, c.stage.redo_sections);
    return {
      content: retry
        ? `${delta}

${retry}`
        : delta,
      useSession: plan.useSession,
    };
  }
  const extra: string[] = [];
  const ho = handoffBlock(await handoffItems(tx, c));
  if (ho) extra.push(ho);
  if (retry) extra.push(retry);
  const tail = ctx.continuing && ctx.executor === "agent" ? await askHistory(tx, c) : null;
  const khSummary = hasKhSummaryTarget(c.head, c.idx); // K1 · D10
  const workspace = c.def.autofix ? autofixWorkspaceBlock(c.def.autofix) : null; // P-c1 · §6.4
  const content = promptOf(c.def, c.head, c.stage.feedback, { extra, tail, khSummary, workspace });
  return { content, useSession: plan.useSession };
}

/** P-c1 · PC-R10 · stage tự-sửa làm lại sau `autofix_check_failed` ⇒ khối "Lần kiểm trước không đạt"; khác ⇒ null. */
async function autofixRetry(tx: Tx, c: StagePromptInput): Promise<string | null> {
  if (!c.def.autofix) return null;
  const fails = await retryFailures(tx, { stageRunId: c.stage.id, tenantId: c.tenantId });
  return fails ? autofixRetryBlock(fails) : null;
}
