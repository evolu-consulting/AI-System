// HUB-FR-114 · HUB-FR-110 · D7 · D8 · D9 · §3.3 · PF1 · chạy stage nhóm: sequential/lead_plan/parallel_merge. Mỗi thành
// viên = 1 `runJob` (team-member, `team_run_id` N4); ghép mục (team.rules); giới hạn nhóm ⇒ `limit`; need_input ⇒
// waiting_answer. D8 làm lại chọn lọc (attempt>1 ⇒ `redoSubset`). Không log nội dung.
import { createHash } from "node:crypto";
import type { DecisionReason } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { RunFile } from "../../attachments/run-files.rules";
import type { RunContext } from "../../runs/runs.service";
import {
  assembleSections,
  clipSummary,
  mergeQuestions,
  parseLeadPlan,
  redoMembers,
  renderDoc,
  type TeamMember,
} from "./team.rules";
import {
  addCall,
  ensureTeamRun,
  hashSame,
  initialDraft,
  limitReason,
  markDone,
  markFailed,
  markLimit,
  markWaiting,
  savePlan as saveTeamPlan,
} from "./team-counters";
import {
  type TeamDeps as Deps,
  loadMembers,
  loadTeam,
  type TeamHead,
  type TeamMemberRow,
} from "./team-load";
import { type MemberCall, type MemberResult, runMember } from "./team-member";
import type { Link, StageResult } from "./team-runner";

type TeamOut = { result: StageResult; usage: number; jobId: string | null };
type Head = {
  tenant_id: string;
  started_by: string;
  conversation_id: string;
  input: string;
  current_stage_idx: number;
  snapshot: { stages: SnapStage[] };
};
type SnapStage = {
  name: string;
  executor: { kind: "team"; team_id: string } | { kind: "agent"; agent_id: string };
  output: { filename: string; template: string; required_sections: string[] };
};
type StageRow = {
  id: string;
  attempt: number;
  feedback: string | null;
  redo_sections: string[] | null; // D8 · gate fail ghi; nguồn `redoMembers` khi làm lại (attempt>1)
  current_output_id: string | null;
};
/** Khung một stage nhóm (một `drive()`): nạp, ghép, trả StageResult cho máy trạng thái. */
export async function runTeamStage(d: Deps, ctx: RunContext, link: Link): Promise<TeamOut> {
  const runId = link.process_run_id ?? "";
  const ld = await load(d, runId);
  if (!ld) return fail("agent_failed");
  const { head, stage, def, team, members } = ld;
  const u: AuthUser = { userId: head.started_by, tenantId: head.tenant_id, role: "member" };
  const tr = await ensureTeamRun(d, {
    tenantId: head.tenant_id,
    procRunId: runId,
    stageId: stage.id,
    attempt: stage.attempt,
    teamId: team.id,
    mode: team.mode,
  });
  const st: Ctx = {
    d,
    u,
    procRunId: runId,
    head,
    def,
    stage,
    team,
    members,
    teamRunId: tr.id,
    keyOf: ld.keys,
    priorFiles: ctx.files,
    signal: ctx.writer.signal,
    draft: await initialDraft(d, stage, members),
    callIdx: 0,
    usage: 0,
    lastJobId: null,
  };
  // HUB-FR-110 · resume: team_run `waiting_answer` ⇒ sequential chạy tiếp từ `cursor` (bỏ thành viên đã xong). Chỉ sequential.
  if (team.mode === "lead_plan") return runLeadPlan(st);
  const toRun = redoSubset(st, members); // D8 · làm lại chọn lọc (attempt>1)
  if (team.mode === "parallel_merge") return runParallel(st, toRun);
  return runSequential(st, toRun, false, tr.resume ? tr.cursor : 0);
}

type Ctx = {
  d: Deps;
  u: AuthUser;
  procRunId: string;
  head: Head;
  def: SnapStage;
  stage: StageRow;
  team: TeamHead;
  members: TeamMemberRow[];
  teamRunId: string;
  keyOf: Map<string, string>;
  priorFiles: readonly RunFile[];
  signal: AbortSignal;
  draft: Map<string, string>;
  callIdx: number;
  usage: number;
  lastJobId: string | null;
};

const fail = (reason: "agent_failed" | "job_timeout"): TeamOut => ({
  result: { kind: "failed", reason },
  usage: 0,
  jobId: null,
});
const limitOut = (st: Ctx, reason: DecisionReason): TeamOut => ({
  result: { kind: "limit", reason },
  usage: st.usage,
  jobId: st.lastJobId,
});

async function load(d: Deps, runId: string) {
  const snap = await d.config.snapshot();
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [head] = await tx.execute<Head>(sql`select tenant_id, started_by, conversation_id, input,
      current_stage_idx, snapshot from hub.process_runs where id = ${runId}`);
    if (!head) return null;
    const idx = Number(head.current_stage_idx);
    const def = head.snapshot.stages[idx];
    if (def?.executor.kind !== "team") return null;
    const [stage] = await tx.execute<StageRow>(sql`select id, attempt, feedback, redo_sections,
      current_output_id from hub.stage_runs where process_run_id = ${runId} and stage_idx = ${idx}`);
    if (!stage) return null;
    const team = await loadTeam(tx, def.executor.team_id);
    if (!team) return null;
    const members = await loadMembers(tx, def.executor.team_id);
    const keyIn = (id: string) => snap.agents.find((a) => a.id === id)?.key ?? id;
    const keys = new Map<string, string>(members.map((m) => [m.agent_id, keyIn(m.agent_id)]));
    if (team.lead_agent_id) keys.set(team.lead_agent_id, keyIn(team.lead_agent_id));
    return { head, stage: { ...stage, attempt: Number(stage.attempt) }, def, team, members, keys };
  });
}

async function runSequential(
  st: Ctx,
  members: TeamMemberRow[],
  fallback: boolean,
  startAt = 0,
): Promise<TeamOut> {
  // `startAt` · resume: bỏ qua thành viên đã xong (index < cursor), chạy tiếp từ thành viên đã hỏi (lần thử 1 ⇒ startAt 0).
  for (let i = Math.max(0, startAt); i < members.length; i++) {
    const m = members[i];
    if (!m) continue;
    const hit = await checkLimit(st);
    if (hit) return await stopLimit(st, hit);
    const res = await callOne(st, seqStep(st, m, fallback));
    const done = await applyMember(st, m, res, i);
    if (done) return done;
  }
  return await finishOutput(st);
}

async function runLeadPlan(st: Ctx): Promise<TeamOut> {
  const leadId = st.team.lead_agent_id;
  if (!leadId) return runSequential(st, st.members, true);
  const hit = await checkLimit(st);
  if (hit) return await stopLimit(st, hit);
  const leadStep: Step = {
    m: leadLike(leadId),
    role: "plan",
    prompt: leadPrompt(st),
    fallback: false,
  };
  const lead = await callOne(st, leadStep);
  if (lead.outcome.kind === "failed") return await stopFail(st, lead);
  if (lead.outcome.kind === "need_input")
    return await pauseAsk(st, [{ role: "Trưởng nhóm", q: lead.outcome.question }], st.callIdx);
  const asTeam: TeamMember[] = st.members.map((m) => ({
    key: st.keyOf.get(m.agent_id) ?? m.agent_id,
    sections: m.sections,
  }));
  const plan = parseLeadPlan(lead.outcome.text, asTeam, st.team.limits.max_plan_steps);
  if (!plan.ok) return runSequential(st, st.members, true);
  await savePlan(st, plan.steps);
  const byKey = new Map(st.members.map((m) => [st.keyOf.get(m.agent_id) ?? m.agent_id, m]));
  const seq = plan.steps.map((s) => byKey.get(s.member)).filter((m): m is TeamMemberRow => !!m);
  return runSequential(st, seq, false);
}

/** D8 · thành viên chạy lượt này: attempt 1 ⇒ cả nhóm; attempt>1 ⇒ lọc theo `redo_sections`/`feedback` (`redoMembers`). */
function redoSubset(st: Ctx, members: TeamMemberRow[]): TeamMemberRow[] {
  if (st.stage.attempt <= 1) return members;
  const key = (m: TeamMemberRow) => st.keyOf.get(m.agent_id) ?? m.agent_id;
  const q = { sections: st.stage.redo_sections ?? undefined, feedback: st.stage.feedback ?? "" };
  const keys = new Set(
    redoMembers(
      members.map((m) => ({ key: key(m), sections: m.sections })),
      q,
    ),
  );
  const sub = members.filter((m) => keys.has(key(m)));
  return sub.length > 0 ? sub : members;
}

async function runParallel(st: Ctx, members: TeamMemberRow[]): Promise<TeamOut> {
  const hit = await checkLimit(st);
  if (hit) return await stopLimit(st, hit);
  const files = draftFiles(st, 1);
  const calls = await Promise.all(
    members.map((m) => runMember(st.d, mkCall(st, seqStep(st, m, false), files))),
  );
  st.callIdx += calls.length;
  for (const r of calls) await bump(st, r);
  const fails = calls.find((r) => r.outcome.kind === "failed");
  if (fails?.outcome.kind === "failed") return await stopFail(st, fails);
  const asks = members
    .map((m, i) => ({ m, r: calls[i] }))
    .filter((x) => x.r?.outcome.kind === "need_input");
  if (asks.length > 0)
    return await pauseAsk(
      st,
      asks.map((x) => ({
        role: x.m.role,
        q: x.r?.outcome.kind === "need_input" ? x.r.outcome.question : "",
      })),
      st.callIdx,
    );
  members.forEach((m, i) => {
    const r = calls[i];
    if (r?.outcome.kind === "output") mergeInto(st, m, r.outcome.text);
  });
  return await finishOutput(st);
}

type Step = { m: TeamMemberRow; role: "member" | "plan"; prompt: string; fallback: boolean };

async function callOne(st: Ctx, step: Step): Promise<MemberResult> {
  const files = draftFiles(st, st.callIdx + 1);
  const res = await runMember(st.d, mkCall(st, step, files));
  st.callIdx += 1;
  await bump(st, res);
  return res;
}

const seqStep = (st: Ctx, m: TeamMemberRow, fallback: boolean): Step => ({
  m,
  role: "member",
  prompt: memberPrompt(st, m),
  fallback,
});

function mkCall(st: Ctx, step: Step, files: RunFile[]): MemberCall {
  return {
    u: st.u,
    conversationId: st.head.conversation_id,
    processRunId: st.procRunId,
    stageRunId: st.stage.id,
    teamRunId: st.teamRunId,
    agentId: step.m.agent_id,
    memberKey: st.keyOf.get(step.m.agent_id) ?? step.m.agent_id,
    role: step.role,
    prompt: step.prompt,
    files,
    fallback: step.fallback,
    signal: st.signal,
  };
}

/** output ⇒ ghép + kiểm no_change (có thể trả limit); need_input/failed ⇒ dừng. null ⇒ tiếp. */
async function applyMember(
  st: Ctx,
  m: TeamMemberRow,
  res: MemberResult,
  cursor: number,
): Promise<TeamOut | null> {
  if (res.outcome.kind === "failed") return await stopFail(st, res);
  if (res.outcome.kind === "need_input")
    return await pauseAsk(st, [{ role: m.role, q: res.outcome.question }], cursor);
  mergeInto(st, m, res.outcome.text);
  const same = await hashStep(st);
  if (same >= 2) return await stopLimit(st, "team_no_change");
  return null;
}

function mergeInto(st: Ctx, m: TeamMemberRow, text: string): void {
  st.draft = assembleSections(st.draft, text, m.sections).next;
}

function draftFiles(st: Ctx, version: number): RunFile[] {
  const text = renderDoc(st.def.output.template, st.draft);
  const file: RunFile = {
    id: crypto.randomUUID(),
    name: `s${Number(st.head.current_stage_idx)}-v${version}-${st.def.output.filename}`,
    mime: "text/markdown",
    size: Math.max(1, Buffer.byteLength(text, "utf8")),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
  return [...st.priorFiles, file];
}

const memberPrompt = (st: Ctx, m: TeamMemberRow): string =>
  [st.head.input.trim(), `Mục của bạn: ${m.sections.join(", ")}.`, feedbackLine(st)]
    .filter((p) => p.length > 0)
    .join("\n\n");
const leadPrompt = (st: Ctx): string =>
  `${st.head.input.trim()}\n\nTrả về kế hoạch JSON các bước {member, sections, instruction}.`;
const feedbackLine = (st: Ctx): string =>
  st.stage.feedback && st.stage.attempt > 1 ? `Góp ý cần sửa:\n${st.stage.feedback.trim()}` : "";

const leadLike = (agentId: string): TeamMemberRow => ({
  agent_id: agentId,
  role: "Trưởng nhóm",
  sections: [],
  position: -1,
});

const checkLimit = (st: Ctx): Promise<DecisionReason | null> =>
  limitReason(st.d, st.teamRunId, st.team.limits);

async function bump(st: Ctx, res: MemberResult): Promise<void> {
  st.usage += res.usage;
  if (res.jobId) st.lastJobId = res.jobId;
  await addCall(st.d, st.teamRunId, res.usage);
}

/** hash bản ghép; trùng 2 lần liền ⇒ no_change. */
async function hashStep(st: Ctx): Promise<number> {
  const h = createHash("sha256")
    .update(renderDoc(st.def.output.template, st.draft), "utf8")
    .digest("hex");
  return hashSame(st.d, st.teamRunId, h);
}

async function stopLimit(st: Ctx, reason: DecisionReason): Promise<TeamOut> {
  await markLimit(st.d, st.teamRunId, reason);
  return limitOut(st, reason);
}

async function stopFail(st: Ctx, res: MemberResult): Promise<TeamOut> {
  const reason = res.outcome.kind === "failed" ? res.outcome.reason : "agent_failed";
  await markFailed(st.d, st.teamRunId);
  return { result: { kind: "failed", reason }, usage: st.usage, jobId: st.lastJobId };
}

/** `cursor` = index thành viên đã hỏi ⇒ resume chạy tiếp đúng từ đó (sequential). */
async function pauseAsk(
  st: Ctx,
  qs: { role: string; q: string }[],
  cursor: number,
): Promise<TeamOut> {
  const merged = mergeQuestions(qs.map((x) => ({ member: "", role: x.role, question: x.q })));
  await markWaiting(st.d, st.teamRunId, cursor);
  return {
    result: { kind: "need_input", question: merged.question, choices: merged.choices },
    usage: st.usage,
    jobId: st.lastJobId,
  };
}

async function finishOutput(st: Ctx): Promise<TeamOut> {
  // D7/P1-31 · lead_plan: mục `required_sections` kế hoạch KHÔNG giao ⇒ không thiếu (lấp "—" để output đủ mục).
  if (st.team.mode === "lead_plan")
    for (const s of st.def.output.required_sections)
      if ((st.draft.get(s) ?? "").trim() === "") st.draft.set(s, "—");
  const text = renderDoc(st.def.output.template, st.draft);
  const sections: Record<string, string> = {};
  const summaries: Record<string, string> = {};
  for (const m of st.members) {
    const key = st.keyOf.get(m.agent_id) ?? m.agent_id;
    for (const s of m.sections) sections[s] = key;
    const body = st.draft.get(m.sections[0] ?? "") ?? "";
    summaries[key] = clipSummary(body, st.team.limits.summary_tokens);
  }
  await markDone(st.d, st.teamRunId);
  return {
    result: { kind: "output", text, sections, summaries },
    usage: st.usage,
    jobId: st.lastJobId,
  };
}

const savePlan = (st: Ctx, steps: unknown): Promise<void> =>
  saveTeamPlan(st.d, st.teamRunId, steps);
