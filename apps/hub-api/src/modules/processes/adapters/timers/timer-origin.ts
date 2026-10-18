// HUB-FR-143 · HUB-FR-144 · PD-R15 · review T12 vòng 2 R2-2/R2-3 · KHÔNG migration: `postponeFailed` lùi `due_at` nên mốc
// gốc không còn trong hàng hẹn. `wait_until`: dựng lại mốc gốc đúng như `enterWait` (ngày gốc từ input/field + offset + giờ
// theo snapshot, múi giờ ĐÃ LƯU trên hàng hẹn, TZ-R04) ⇒ output "Đã chờ tới …" và backoff dùng ngày người dùng cấu hình.
// `retry`: hạn gốc ≈ `created_at` (backoff retry cỡ giây–phút). Mốc dựng lại luôn ≤ `due_at` hiện tại (lùi chỉ làm muộn);
// lớn hơn ⇒ dữ liệu nguồn đã đổi ⇒ giữ `due_at` hiện tại (không đoán).
import type { Tx } from "@ai/db";
import { waitDueAt } from "../../domain/timers/due-at.rules";
import { waitRepo } from "./wait.repo";

/** Giờ mặc định khi snapshot cũ không có `time` (như `enter-wait.usecase`). */
const WAIT_TIME_DEFAULT = "09:00";

type SnapStage = {
  key?: string;
  executor?: {
    kind?: string;
    from?: { kind?: string; key?: string; stage_key?: string; field?: string };
    offset_days?: number;
    time?: string;
  };
};
export type SnapshotStages = { stages?: SnapStage[] };

export type WaitOriginIn = {
  runId: string;
  snapshot: SnapshotStages;
  stageIdx: number;
  timezone: string;
  /** `due_at` hiện tại của hàng hẹn (có thể đã lùi). */
  dueAt: Date;
};

/** Mốc `wait_until` gốc; không dựng lại được ⇒ `dueAt` hiện tại. */
export async function waitOriginalDue(tx: Tx, tenantId: string, i: WaitOriginIn): Promise<Date> {
  const stages = i.snapshot.stages ?? [];
  const e = stages[i.stageIdx]?.executor;
  if (e?.kind !== "wait_until" || !e.from) return i.dueAt;
  let src: Parameters<ReturnType<typeof waitRepo>["loadBase"]>[1];
  if (e.from.kind === "input" && e.from.key) src = { kind: "input", key: e.from.key };
  else {
    const stageIdx = stages.findIndex((s) => s.key === e.from?.stage_key);
    if (stageIdx < 0 || !e.from.field) return i.dueAt;
    src = { kind: "field", stageIdx, field: e.from.field };
  }
  const { base } = await waitRepo(tx, tenantId).loadBase(i.runId, src);
  const due = waitDueAt({
    base,
    offsetDays: e.offset_days ?? 0,
    time: e.time ?? WAIT_TIME_DEFAULT,
    tz: i.timezone,
    now: i.dueAt,
    expiresAt: null,
  });
  return due.ok && due.dueAt.getTime() <= i.dueAt.getTime() ? due.dueAt : i.dueAt;
}
