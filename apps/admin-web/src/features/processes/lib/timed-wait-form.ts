// CR-120 · G3/G4 · editor: node `wait_for` (chờ N giờ) / `wait_event` (chờ sự kiện + hạn). Thuần, theo khuôn `wait-form`:
// ép giá trị khoá (tự chạy tiếp, không hành động thật), đổi qua lại với contract, validate form (cùng giới hạn contract).
import {
  type ProcessStageDef,
  WAIT_EVENT_KEY_RE,
  WAIT_EVENT_TIMEOUT_H,
  WAIT_FOR_HOURS,
} from "@ai/contracts/hub-admin";
import type { StageDraft, WaitDraft } from "./draft-types";

/** Không import `wait-form` (nó gọi `timedWaitErrors` ở đây) ⇒ lặp hằng nhỏ để tránh vòng import. */
const WAIT_FOR_EXECUTOR = "wait_for";
const WAIT_EVENT_EXECUTOR = "wait_event";
const emptyWait = (): WaitDraft => ({ source: "", offset: "0", time: "09:00" });
const FIXED: Partial<StageDraft> = { real: false, after: "auto", backTo: [], groupId: "" };

type Ex<K extends string> = Extract<ProcessStageDef["executor"], { kind: K }>;

export const WAIT_FOR_PATCH: Partial<StageDraft> = {
  ...FIXED,
  executor: WAIT_FOR_EXECUTOR,
  wait: { ...emptyWait(), hours: "24" },
};
export const WAIT_EVENT_PATCH: Partial<StageDraft> = {
  ...FIXED,
  executor: WAIT_EVENT_EXECUTOR,
  wait: { ...emptyWait(), event: "", timeoutH: "72" },
};

export const waitForFromDef = (ex: Ex<"wait_for">): WaitDraft => ({
  ...emptyWait(),
  hours: String(ex.hours),
});
export const waitEventFromDef = (ex: Ex<"wait_event">): WaitDraft => ({
  ...emptyWait(),
  event: ex.event,
  timeoutH: String(ex.timeout_h),
  ...(ex.also_events ? { also: [...ex.also_events] } : {}),
  ...(ex.branches ? { branches: ex.branches.map((b) => ({ on: b.on, step: b.goto_step })) } : {}),
});
export const waitForToDef = (w: WaitDraft): Ex<"wait_for"> => ({
  kind: "wait_for",
  hours: Number((w.hours ?? "").trim()),
});
export const waitEventToDef = (w: WaitDraft): Ex<"wait_event"> => ({
  kind: "wait_event",
  event: (w.event ?? "").trim(),
  timeout_h: Number((w.timeoutH ?? "").trim()),
  ...(w.also?.length ? { also_events: w.also } : {}),
  ...(w.branches?.some((b) => b.step !== null)
    ? {
        branches: w.branches.flatMap((b) =>
          b.step === null ? [] : [{ on: b.on, goto_step: b.step }],
        ),
      }
    : {}),
});

const intIn = (v: string | undefined, r: { min: number; max: number }): boolean => {
  const n = Number((v ?? "").trim());
  return (v ?? "").trim() !== "" && Number.isInteger(n) && n >= r.min && n <= r.max;
};

/** Lỗi form theo path như server (`stages.i.executor.hours|event|timeout_h`) — khoá i18n `timedWait.err`. */
export function timedWaitErrors(s: StageDraft, i: number, e: Record<string, string>): void {
  const err = "process.admin.editor.stage.timedWait.err";
  const w = s.wait;
  if (s.executor === WAIT_FOR_EXECUTOR && !intIn(w.hours, WAIT_FOR_HOURS))
    e[`stages.${i}.executor.hours`] = err;
  if (s.executor === WAIT_EVENT_EXECUTOR) {
    if (!WAIT_EVENT_KEY_RE.test((w.event ?? "").trim())) e[`stages.${i}.executor.event`] = err;
    if (!intIn(w.timeoutH, WAIT_EVENT_TIMEOUT_H)) e[`stages.${i}.executor.timeout_h`] = err;
  }
}
