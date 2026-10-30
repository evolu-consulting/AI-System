// CR-104 · ops-core · một lượt kiểm ops-watch. Nền (`runChecksOnce`): tick ngắn, chỉ chạy khi đến hạn theo `every_min` tính từ
// `last_round_at` trong DB (đổi tần suất có hiệu lực không cần restart) và khi giành được lượt (nhiều instance ⇒ một lượt).
// "Kiểm tra ngay" (`runChecksNow`): bỏ qua hạn, giới hạn 1 lần/phút. Check chạy NGOÀI tx (gọi mạng có hạn giờ); kết quả ghi một tx.
import type { OpsSettings } from "@ai/contracts/hub-admin";
import type { OpsRepo } from "../adapters/ops.repo";
import { isDue, manualAllowed, notificationsFor, type Transition } from "../domain/ops.rules";
import { type OpsCheck, type OpsCheckDeps, type OpsCheckOutcome, runEnabled } from "./ops.check";

export const OPS_MANUAL_GAP_MS = 60_000;

export type OpsRoundDeps = {
  repo: OpsRepo;
  checks: readonly OpsCheck[];
  /** Phụ thuộc truyền cho check (trừ `now`/`signal` do lượt đặt). */
  checkDeps: Omit<OpsCheckDeps, "now" | "signal" | "prev">;
  /** Hạn giờ mặc định mỗi check (ms). */
  timeoutMs?: number;
};

export type OpsRoundResult =
  | { ran: false; reason: "not_due" | "claimed_elsewhere" | "rate_limited" }
  | { ran: true; results: OpsCheckOutcome[]; transitions: Transition[]; notified: number };

async function round(d: OpsRoundDeps, settings: OpsSettings, now: Date): Promise<OpsRoundResult> {
  const prev = await d.repo.previous(new Date(now.getTime() - 2 * settings.every_min * 60_000));
  const results = await runEnabled(d.checks, { ...d.checkDeps, now, prev }, settings, d.timeoutMs);
  const w = await d.repo.writeRound(results, now, notificationsFor);
  return { ran: true, results, ...w };
}

/** Lượt nền: 1 câu khi chưa đến hạn; đến hạn ⇒ giành lượt (1 câu) ⇒ chạy check ⇒ ghi (1 tx). */
export async function runChecksOnce(
  d: OpsRoundDeps,
  now: Date = new Date(),
): Promise<OpsRoundResult> {
  const s = await d.repo.state();
  if (!isDue(s.last_round_at, s.settings.every_min, now)) return { ran: false, reason: "not_due" };
  if (!(await d.repo.claimRound(s.last_round_at, now)))
    return { ran: false, reason: "claimed_elsewhere" };
  return round(d, s.settings, now);
}

/** "Kiểm tra ngay": bỏ qua hạn; lần bấm trước < 1 phút (mọi instance) ⇒ `rate_limited`. */
export async function runChecksNow(
  d: OpsRoundDeps,
  now: Date = new Date(),
): Promise<OpsRoundResult> {
  const s = await d.repo.state();
  if (!manualAllowed(s.last_manual_at, OPS_MANUAL_GAP_MS, now))
    return { ran: false, reason: "rate_limited" };
  if (!(await d.repo.claimManual(now, OPS_MANUAL_GAP_MS)))
    return { ran: false, reason: "rate_limited" };
  return round(d, s.settings, now);
}
