// CR-121 · R-2 · ghép hàng DB → DTO `RunDetail` / `RunStageLog` (thuần, không I/O). Mức `basic` KHÔNG bao giờ mang mã lỗi,
// thông điệp gốc, payload job hay nội dung đầu ra — các trường đó chỉ được thêm khi `level = "debug"` (service quyết theo vai).
import {
  DECISION_REASONS,
  type DecisionReason,
  type RunDetail,
  type RunDetailStep,
  type RunStageLog,
} from "@ai/contracts/chat";
import {
  executorName,
  friendlyError,
  type LogLevel,
  originLabel,
  resultText,
  runStatusText,
  stepNote,
  stepStateOf,
} from "../domain/runs/run-log-text.rules";
import { redactJson, redactText } from "../domain/runs/run-redact.rules";
import {
  buildTimeline,
  conditionsOf,
  type TlEvent,
  type TlStage,
} from "../domain/runs/run-timeline.rules";
import type { DebugRow, HeadRow, LogRow, SnapStageLite, StageRow } from "./run-detail.repo";

type Status = RunDetailStep["raw_status"];
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));
const stageName = (d: SnapStageLite | null | undefined, idx: number) =>
  d?.name || `Bước ${idx + 1}`;
const asReason = (r: string | null): DecisionReason | null =>
  r !== null && (DECISION_REASONS as readonly string[]).includes(r) ? (r as DecisionReason) : null;

function toStep(s: StageRow, defs: SnapStageLite[], matched: ReadonlyMap<number, Set<number>>) {
  const idx = Number(s.stage_idx);
  const def = defs[idx];
  const name = stageName(def, idx);
  const kind = def?.executor?.kind ?? "agent";
  const raw = s.status as Status;
  const note = stepNote({
    raw,
    name,
    lastErrorCode: s.last_error_code,
    retryCount: Number(s.retry_count),
  });
  const step: RunDetailStep = {
    idx,
    step: def?.step ?? idx,
    name,
    executor: { kind, name: executorName(kind, s.exec_vi, s.exec_en) },
    state: stepStateOf(raw, s.started_at),
    raw_status: raw,
    attempt: Number(s.attempt),
    attempt_limit: Number(s.attempt_limit),
    round: Number(s.round),
    started_at: s.started_at,
    finished_at: s.finished_at,
    duration_ms: s.finished_at ? num(s.duration_ms) : null,
    conditions: conditionsOf(def?.after?.branch, matched.get(idx) ?? new Set<number>()),
    ...(note && { note }),
  };
  return step;
}

type DebugAttempt = DebugRow["attempts"][number];
const redactOpt = (s: string | null) => (s === null ? null : redactText(s));
/** Che secret trong thông điệp lỗi gốc + payload job (khoá nhạy cảm, Bearer…) trước khi trả debug. */
const redactAttempt = (a: DebugAttempt): DebugAttempt => ({
  ...a,
  error_message: redactOpt(a.error_message),
  jobs: a.jobs.map((j) => ({
    ...j,
    error_message: redactOpt(j.error_message),
    payload: redactJson(j.payload),
  })),
});
/** Luật rẽ nhánh đã khớp theo stage (từ audit `branch`). */
const matchedRules = (events: readonly TlEvent[]): Map<number, Set<number>> => {
  const m = new Map<number, Set<number>>();
  for (const e of events)
    if (e.src === "audit" && e.sub === "branch" && e.stageIdx !== null && e.a !== null) {
      const set = m.get(e.stageIdx) ?? new Set<number>();
      set.add(e.a);
      m.set(e.stageIdx, set);
    }
  return m;
};

export function toRunDetail(
  h: HeadRow,
  stages: readonly StageRow[],
  events: readonly TlEvent[],
): RunDetail {
  const defs = h.snapshot.stages ?? [];
  const matched = matchedRules(events);
  const steps = stages.map((s) => toStep(s, defs, matched));
  const cur = steps.find((s) => s.idx === Number(h.current_stage_idx));
  const startedBy = h.started_by
    ? { id: h.started_by, display_name: h.started_by_name ?? h.started_by }
    : null;
  const processName = h.snapshot.name || h.snapshot.key || "";
  const tlStages: TlStage[] = stages.map((s, i) => ({
    idx: Number(s.stage_idx),
    name: steps[i]?.name ?? "",
    status: s.status,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    updatedAt: s.updated_at,
    lastErrorCode: s.last_error_code,
  }));
  const decisionReason = asReason(h.decision_reason);
  return {
    id: h.id,
    tenant: { id: h.tenant_id, name: h.tenant_name ?? "" },
    process: { key: h.snapshot.key ?? "", name: processName, version: Number(h.def_version) },
    started_by: startedBy,
    origin: {
      kind: h.origin_kind as RunDetail["origin"]["kind"],
      label: originLabel(h.origin_kind),
    },
    status: h.status as RunDetail["status"],
    status_text: runStatusText({
      status: h.status,
      decisionReason: h.status === "needs_decision" ? decisionReason : null,
      currentStageName: cur?.name ?? null,
    }),
    decision_reason: decisionReason,
    current_step: Number(h.current_step),
    current_stage_idx: Number(h.current_stage_idx),
    current_stage_name: cur?.name ?? null,
    started_at: h.started_at,
    finished_at: h.finished_at,
    is_test: h.is_test,
    steps,
    timeline: buildTimeline(
      {
        startedAt: h.started_at,
        finishedAt: h.finished_at,
        status: h.status,
        startedBy,
        processName,
      },
      tlStages,
      events,
    ).map((t) => ({
      at: t.at,
      kind: t.kind,
      stage_idx: t.stageIdx,
      actor: t.actor,
      text: t.text,
      ref_run_id: t.refRunId ?? null,
    })),
  };
}

/** `debug` chỉ truyền khi `level = "debug"` (service chỉ đọc khi vai là platform_admin). */
export function toStageLog(row: LogRow, level: LogLevel, debug?: DebugRow): RunStageLog {
  const idx = Number(row.stage_idx);
  const name = stageName(row.stage_def, idx);
  const kind = row.stage_def?.executor?.kind ?? "agent";
  const raw = row.status as Status;
  const state = stepStateOf(raw, row.started_at);
  const hasError = state === "error" || state === "needs_decision" || row.last_error_code !== null;
  const dbg = level === "debug";
  return {
    level,
    run_id: row.run_id,
    stage: {
      idx,
      name,
      executor: { kind, name: executorName(kind, row.exec_vi, row.exec_en) },
      state,
      raw_status: raw,
      attempt: Number(row.attempt),
      attempt_limit: Number(row.attempt_limit),
      started_at: row.started_at,
      finished_at: row.finished_at,
      duration_ms: row.finished_at ? num(row.duration_ms) : null,
    },
    skip_reason:
      raw === "skipped"
        ? (stepNote({ raw, name, lastErrorCode: null, retryCount: 0 }) ?? null)
        : null,
    error_text: hasError ? friendlyError(row.last_error_code, name) : null,
    tasks: row.tasks.map((t) => ({
      id: t.id,
      kind: t.kind as RunStageLog["tasks"][number]["kind"],
      status: t.status as RunStageLog["tasks"][number]["status"],
      result: t.result as RunStageLog["tasks"][number]["result"],
      assignees: t.assignees,
      decided_by: t.decided_by
        ? { id: t.decided_by, display_name: t.decided_by_name ?? t.decided_by }
        : null,
      decided_at: t.decided_at,
      created_at: t.created_at,
      comment: t.feedback,
      question: t.question,
      answer: t.answer,
      outcome:
        resultText(t.result) ??
        (t.kind === "decision" && t.reason ? friendlyError(t.reason, name) : null),
    })),
    outputs: row.outputs.map((o) => ({
      id: o.id,
      version: Number(o.version),
      attempt: Number(o.attempt),
      round: Number(o.round),
      template_ok: o.template_ok,
      created_at: o.created_at,
      ...(dbg && o.content !== null && { content: redactText(o.content) }),
    })),
    ...(dbg &&
      debug && {
        debug: {
          last_error_code: row.last_error_code,
          attempts: debug.attempts.map(redactAttempt),
          retries: debug.retries,
          kh_queries: debug.kh_queries === null ? null : Number(debug.kh_queries),
          kh_warning: debug.kh_warning,
        },
      }),
  };
}
