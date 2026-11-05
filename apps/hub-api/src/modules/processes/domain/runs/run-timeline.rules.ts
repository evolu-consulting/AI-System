// CR-121 · R-2 · dựng dòng thời gian lượt chạy từ (a) hàng run/stage và (b) các sự kiện đã gom bằng MỘT câu union
// (task mở/nhắc/chuyển cấp/đóng, hẹn thử lại, quay lại, audit rẽ nhánh/huỷ/dừng/chạy lại). Thuần, lớp 1 (không I/O).
import type { RunTimelineKind } from "@ai/contracts/chat";
import { controlReasonText, friendlyError, type I18n, resultText } from "./run-log-text.rules";

export type TlPerson = { id: string; display_name: string };
export type TlRun = {
  startedAt: string;
  finishedAt: string | null;
  status: string;
  startedBy: TlPerson | null;
  processName: string;
};
export type TlStage = {
  idx: number;
  name: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  lastErrorCode: string | null;
};
/** Một hàng của câu union sự kiện (`run-detail.repo.ts`). `src` xác định cách đọc `sub`/`sub2`/`a`/`b`. */
export type TlEvent = {
  src:
    | "task_open"
    | "task_remind"
    | "task_escalate"
    | "task_close"
    | "timer_retry"
    | "back"
    | "audit";
  at: string;
  stageIdx: number | null;
  /** task_*: loại task (review/ask/decision) · audit: `summary.op` (stop/rerun_step/rerun) hoặc action (branch/cancel). */
  sub: string | null;
  /** task_close: kết quả · audit dừng/chạy lại: lý do (`RUN_CONTROL_REASONS`). */
  sub2: string | null;
  actor: TlPerson | null;
  /** task_remind: lần nhắc · back: bước đích · audit branch: luật khớp. */
  a: number | null;
  /** back: vòng sau khi quay lại · audit branch: bước đích. */
  b: number | null;
  /** audit `rerun` cả lượt: id lượt gốc (`summary.rerun_of`). */
  ref: string | null;
};
export type TlItem = {
  at: string;
  kind: RunTimelineKind;
  stageIdx: number | null;
  actor: TlPerson | null;
  text: I18n;
  refRunId?: string | null;
};

export const TIMELINE_MAX = 200;
// Thứ tự phụ khi cùng mốc: bắt đầu → bước → nhắc/chuyển cấp → quyết định → kết thúc.
const ORDER: Readonly<Record<RunTimelineKind, number>> = {
  started: 0,
  step_started: 1,
  retry: 2,
  error: 3,
  reminder: 4,
  escalate: 5,
  decision_requested: 6,
  review: 7,
  decision: 8,
  branch: 9,
  back: 10,
  step_done: 11,
  step_skipped: 12,
  stopped: 13,
  rerun: 14,
  finished: 15,
};

const FINISH_TEXT: Readonly<Record<string, I18n>> = {
  done: { vi: "Lượt chạy hoàn thành", en: "Run completed" },
  cancelled: { vi: "Lượt chạy đã bị huỷ", en: "Run cancelled" },
  failed: { vi: "Lượt chạy thất bại", en: "Run failed" },
  expired: { vi: "Lượt chạy hết hạn", en: "Run expired" },
};

const ASK_OF: Readonly<Record<string, I18n>> = {
  review: { vi: "Chờ duyệt kết quả", en: "Waiting for a review" },
  ask: { vi: "Trợ lý đặt câu hỏi, chờ trả lời", en: "The agent asked a question and is waiting" },
  decision: { vi: "Cần người quyết định", en: "A decision is needed" },
};

/** `[kind, vi, en]` của một sự kiện; `null` ⇒ bỏ qua. */
type Made = readonly [RunTimelineKind, string, string] | null;
const q = (n: string) => `"${n}"`;

/** Hậu tố "bởi <người> · lý do: <lý do>" cho dừng/chạy lại (R-1 ghi người + lý do vào audit). */
function byReason(e: TlEvent): I18n {
  const r = controlReasonText(e.sub2);
  const who = e.actor?.display_name;
  return {
    vi: `${who ? ` bởi ${who}` : ""}${r ? ` · lý do: ${r.vi}` : ""}`,
    en: `${who ? ` by ${who}` : ""}${r ? ` · reason: ${r.en}` : ""}`,
  };
}

function controlMade(e: TlEvent, n: string): Made {
  const s = byReason(e);
  switch (e.sub) {
    case "stop":
    case "cancel": // `cancel` không có `op` = đường huỷ cũ (không lý do)
      return ["stopped", `Dừng${s.vi}`, `Stopped${s.en}`];
    case "rerun_step":
      return [
        "rerun",
        `Chạy lại từ bước ${(e.stageIdx ?? 0) + 1} ${q(n)}${s.vi}`,
        `Rerun from step ${(e.stageIdx ?? 0) + 1} ${q(n)}${s.en}`,
      ];
    case "rerun":
      return ["rerun", `Chạy lại cả lượt${s.vi}`, `Rerun of the whole run${s.en}`];
    default:
      return null;
  }
}

function auditMade(e: TlEvent, n: string): Made {
  if (e.sub !== "branch") return controlMade(e, n);
  return [
    "branch",
    `Rẽ nhánh theo luật ${e.a ?? "?"}: nhảy tới bước ${(e.b ?? 0) + 1} — bước ${q(n)}`,
    `Branched by rule ${e.a ?? "?"}: jumped to step ${(e.b ?? 0) + 1} — step ${q(n)}`,
  ];
}
function closeMade(e: TlEvent, n: string): Made {
  const r = resultText(e.sub2);
  const who = e.actor ? ` (${e.actor.display_name})` : "";
  return [
    e.sub === "decision" ? "decision" : "review",
    `${r?.vi ?? "Đã xử lý"}${who} — bước ${q(n)}`,
    `${r?.en ?? "Handled"}${who} — step ${q(n)}`,
  ];
}

function openMade(e: TlEvent, n: string): Made {
  const t = ASK_OF[e.sub ?? "review"] ?? (ASK_OF.review as I18n);
  return [
    e.sub === "decision" ? "decision_requested" : "review",
    `${t.vi} — bước ${q(n)}`,
    `${t.en} — step ${q(n)}`,
  ];
}

const MADE: Readonly<Record<TlEvent["src"], (e: TlEvent, n: string) => Made>> = {
  task_open: openMade,
  task_remind: (e, n) => [
    "reminder",
    `Đã nhắc người duyệt (lần ${e.a ?? 1}) — bước ${q(n)}`,
    `Reviewer reminded (#${e.a ?? 1}) — step ${q(n)}`,
  ],
  task_escalate: (_e, n) => [
    "escalate",
    `Việc duyệt chưa ai xử lý nên đã chuyển cấp — bước ${q(n)}`,
    `Nobody handled the review, so it was escalated — step ${q(n)}`,
  ],
  task_close: closeMade,
  timer_retry: (_e, n) => [
    "retry",
    `Hệ thống hẹn thử lại — bước ${q(n)}`,
    `The system scheduled a retry — step ${q(n)}`,
  ],
  back: (e) => [
    "back",
    `Quay lại bước ${(e.a ?? 0) + 1} để làm lại (vòng ${e.b ?? 2})`,
    `Went back to step ${(e.a ?? 0) + 1} for rework (round ${e.b ?? 2})`,
  ],
  audit: auditMade,
};

function eventItem(e: TlEvent, name: (i: number | null) => string): TlItem | null {
  const m = MADE[e.src](e, name(e.stageIdx));
  if (!m) return null;
  return {
    at: e.at,
    stageIdx: e.stageIdx,
    actor: e.actor,
    kind: m[0],
    text: { vi: m[1], en: m[2] },
    refRunId: e.src === "audit" && e.sub === "rerun" ? e.ref : null,
  };
}

function stageItems(s: TlStage): TlItem[] {
  const out: TlItem[] = [];
  const add = (atIso: string, kind: RunTimelineKind, text: I18n) =>
    out.push({ at: atIso, kind, stageIdx: s.idx, actor: null, text });
  if (s.startedAt)
    add(s.startedAt, "step_started", {
      vi: `Bắt đầu bước ${q(s.name)}`,
      en: `Started step ${q(s.name)}`,
    });
  if (s.status === "done" && s.finishedAt)
    add(s.finishedAt, "step_done", {
      vi: `Xong bước ${q(s.name)}`,
      en: `Finished step ${q(s.name)}`,
    });
  if (s.status === "skipped")
    add(s.finishedAt ?? s.updatedAt, "step_skipped", {
      vi: `Bỏ qua bước ${q(s.name)}`,
      en: `Skipped step ${q(s.name)}`,
    });
  if ((s.status === "failed" || s.status === "needs_decision") && s.lastErrorCode)
    add(s.finishedAt ?? s.updatedAt, "error", friendlyError(s.lastErrorCode, s.name));
  return out;
}

/** Dòng thời gian tăng dần theo mốc (≤ 200 mục). Bước xong/bỏ qua/lỗi lấy từ `stages`, phần còn lại từ `events`. */
export function buildTimeline(
  run: TlRun,
  stages: readonly TlStage[],
  events: readonly TlEvent[],
): TlItem[] {
  const names = new Map(stages.map((s) => [s.idx, s.name]));
  const nameOf = (i: number | null) => (i === null ? "" : (names.get(i) ?? String(i + 1)));
  const by = run.startedBy;
  const out: TlItem[] = [
    {
      at: run.startedAt,
      kind: "started",
      stageIdx: null,
      actor: by,
      text: {
        vi: `Bắt đầu quy trình ${q(run.processName)}${by ? ` bởi ${by.display_name}` : ""}`,
        en: `Started ${q(run.processName)}${by ? ` by ${by.display_name}` : ""}`,
      },
    },
    ...stages.flatMap(stageItems),
    ...events.flatMap((e) => eventItem(e, nameOf) ?? []),
  ];
  const fin = run.finishedAt ? FINISH_TEXT[run.status] : undefined;
  if (run.finishedAt && fin)
    out.push({ at: run.finishedAt, kind: "finished", stageIdx: null, actor: null, text: fin });
  out.sort((x, y) => x.at.localeCompare(y.at) || ORDER[x.kind] - ORDER[y.kind]);
  return out.slice(0, TIMELINE_MAX);
}

export type StepCondition = {
  rule: number;
  field: string;
  op: string;
  value: string | number;
  goto_step: number;
  matched: boolean;
};

/** Điều kiện rẽ nhánh của stage (`snapshot.stages[i].after.branch`) + luật đã khớp (`rules` = số thứ tự 1-based từ audit `branch`). */
export function conditionsOf(branch: unknown, matchedRules: ReadonlySet<number>): StepCondition[] {
  if (!Array.isArray(branch)) return [];
  const out: StepCondition[] = [];
  branch.slice(0, 10).forEach((r: unknown, i) => {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const value = o.value;
    if (typeof o.field !== "string" || typeof o.op !== "string") return;
    if (typeof value !== "string" && typeof value !== "number") return;
    out.push({
      rule: i + 1,
      field: o.field,
      op: o.op,
      value,
      goto_step: typeof o.goto_step === "number" ? o.goto_step : 0,
      matched: matchedRules.has(i + 1),
    });
  });
  return out;
}
