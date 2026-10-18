// HUB-FR-144 · AC-H41 · PD-R10/R13/R14/R15 · TZ-R04 · plan §4.6 (Vào) · use case lớp 2: stage `wait_until` tới lượt ⇒ tính
// `due_at` theo múi giờ tenant đọc TRONG tx lưu hẹn, ghi stage `waiting_timer` + hẹn `wait_until` (khoá idempotency `n`
// đếm dưới khoá run). Không hợp lệ ⇒ trả `invalid` để người gọi mở `needs_decision{timer_invalid}` (luồng cũ `toDecision`).
// `due_at ≤ now` vẫn ghi hẹn (tới hạn ngay — vòng quét kế bắn, D-PD09). Chạy trong tx người gọi, run ĐÃ khoá; không `Tx`.
import type { WaitFrom } from "../../domain/defs/wait-def.rules";
import { type WaitDue, waitDueAt } from "../../domain/timers/due-at.rules";
import { timerKey } from "../../domain/timers/timer-key.rules";
import type { TimerRepo } from "../ports";
import type { TenantTzReader, WaitRepo, WaitSource } from "./wait.ports";

/** PD-R13 · Q4 · giờ mặc định khi snapshot cũ không có `time` (contract `WAIT_TIME_DEFAULT`). */
const WAIT_TIME_DEFAULT = "09:00";

export type EnterWaitRepos = {
  timers: Pick<TimerRepo, "countByStageKind" | "insert">;
  wait: WaitRepo;
  tz: TenantTzReader;
};

export type EnterWaitIn = {
  runId: string;
  stageRunId: string;
  round: number;
  attempt: number;
  wait: { from: WaitFrom; offsetDays: number; time?: string };
  /** `key` của mọi stage trong snapshot (giải `from.field.stageKey` ⇒ chỉ số stage nguồn). */
  stageKeys: readonly string[];
  now: Date;
};

export type EnterWaitOut =
  | { kind: "waiting"; dueAt: Date; timezone: string }
  | { kind: "invalid"; why: Extract<WaitDue, { ok: false }>["why"] };

/** Nguồn ngày: input ⇒ key; field ⇒ chỉ số stage theo key (không thấy ⇒ null ⇒ thiếu ngày). */
function sourceOf(from: WaitFrom, stageKeys: readonly string[]): WaitSource | null {
  if (from.kind === "input") return { kind: "input", key: from.key };
  const stageIdx = stageKeys.indexOf(from.stageKey);
  return stageIdx < 0 ? null : { kind: "field", stageIdx, field: from.field };
}

export async function enterWait(r: EnterWaitRepos, i: EnterWaitIn): Promise<EnterWaitOut> {
  const src = sourceOf(i.wait.from, i.stageKeys);
  if (!src) return { kind: "invalid", why: "missing" };
  const { base, expiresAt } = await r.wait.loadBase(i.runId, src);
  const tz = await r.tz.read();
  const due = waitDueAt({
    base,
    offsetDays: i.wait.offsetDays,
    time: i.wait.time ?? WAIT_TIME_DEFAULT,
    tz,
    now: i.now,
    expiresAt,
  });
  if (!due.ok) return { kind: "invalid", why: due.why };
  // Thứ tự khoá plan §6: run (người gọi) → stage → timer.
  await r.wait.markWaiting(i.stageRunId, i.now);
  const n = (await r.timers.countByStageKind(i.stageRunId, "wait_until")) + 1;
  await r.timers.insert({
    runId: i.runId,
    stageRunId: i.stageRunId,
    kind: "wait_until",
    dueAt: due.dueAt,
    key: timerKey({
      kind: "wait_until",
      stageRunId: i.stageRunId,
      round: i.round,
      attempt: i.attempt,
      n,
    }),
    timezone: tz,
  });
  return { kind: "waiting", dueAt: due.dueAt, timezone: tz };
}
