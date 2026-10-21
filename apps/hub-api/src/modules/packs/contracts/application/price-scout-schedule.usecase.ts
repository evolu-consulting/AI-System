// price-scout · vòng dò giá theo lịch (khuôn HD4): tìm tenant có SP tới hạn (role job) ⇒ trong tx hệ thống của tenant MỘT câu nhận
// lô SP (`FOR UPDATE SKIP LOCKED`, giới hạn theo lượt đang chạy của tenant + trần ngày + trần tháng — hết trần ⇒ 0 SP, bỏ qua) ⇒
// gọi agent song song (≤ số lượt cho phép) NGOÀI tx ⇒ MỘT câu lưu cả lô (giá nguồn market, cảnh báo, lịch kế, token, gỡ lease).
// Lỗi agent ⇒ thử lại sau 1 ngày. Không ngủ chờ: `drain` chạy tới khi hết tenant có việc rồi trả.
import type { PackSystemUow } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import {
  effectiveConfig,
  groupDefaults,
  monthStart,
  nextScoutAt,
  scoutAlerts,
  scoutPrompt,
  toExVat,
} from "../domain/price-scout.rules";
import { parseSearchReply } from "../domain/price-search.rules";
import type {
  ClaimedProduct,
  ScheduleLimits,
  ScoutAgent,
  ScoutDueFinder,
  ScoutResult,
  ScoutScheduleRepo,
} from "./price-scout.ports";

export type ScoutSchedulerDeps = {
  finder: ScoutDueFinder;
  uow: PackSystemUow<{ schedule: ScoutScheduleRepo }>;
  agent: ScoutAgent;
  /** agents-background · agent dò giá còn bật cho công ty; false ⇒ bỏ qua tenant (không nhận lô, lịch giữ nguyên). Vắng ⇒ bật. */
  enabled?: (tenantId: string) => Promise<boolean>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  limits: ScheduleLimits;
  now: () => Date;
  timeoutMs: number;
  /** Trần số lượt nhận lô mỗi `drain` (lưới an toàn). */
  maxRounds?: number;
};

const RETRY_MS = 86_400_000;

async function scoutOne(
  d: ScoutSchedulerDeps,
  { tenantId, day, at }: { tenantId: string; day: string; at: Date },
  p: ClaimedProduct,
): Promise<ScoutResult> {
  const cfg = effectiveConfig(groupDefaults(p.group_saved), p.override);
  const out = await d.agent({
    tenantId,
    userId: null,
    productId: p.product_id,
    trigger: "schedule",
    prompt: scoutPrompt(p.name, cfg),
    signal: AbortSignal.timeout(d.timeoutMs),
  });
  const retry = new Date(at.getTime() + RETRY_MS).toISOString();
  const base = { product_id: p.product_id, items: [], alerts: [], tokens: 0, next_at: retry };
  if (!out.ok)
    return {
      ...base,
      status:
        out.code === "UNAVAILABLE" ? "unavailable" : out.code === "CAP_EXCEEDED" ? "cap" : "failed",
    };
  const parsed = parseSearchReply(out.text, day, cfg.exclude_sites);
  if (!parsed) return { ...base, status: "failed", tokens: out.tokens };
  const items = toExVat(parsed, cfg.vat);
  const prev = new Map(Object.entries(p.previous));
  return {
    product_id: p.product_id,
    status: items.length ? "ok" : "empty",
    items,
    alerts: scoutAlerts(items, cfg, p.avg_cost, prev),
    tokens: out.tokens,
    next_at: nextScoutAt(cfg, at, at)?.toISOString() ?? null,
  };
}

export function createScoutScheduler(d: ScoutSchedulerDeps) {
  /** Một lô của một tenant; trả số SP đã dò. */
  async function tenantOnce(tenantId: string): Promise<number> {
    if (d.enabled && !(await d.enabled(tenantId))) return 0;
    const at = d.now();
    const day = localDate(at, await d.timeZoneOf(tenantId));
    const claimed = await d.uow.system(tenantId, (r) =>
      r.schedule.claim(at.toISOString(), day, monthStart(day), d.limits),
    );
    if (claimed.length === 0) return 0;
    const results = await Promise.all(claimed.map((p) => scoutOne(d, { tenantId, day, at }, p)));
    await d.uow.system(tenantId, (r) => r.schedule.apply(d.now().toISOString(), day, results));
    return claimed.length;
  }

  return {
    tenantOnce,
    /** Chạy tới hết tenant có việc (tenant hết lượt/trần ⇒ bỏ qua trong lượt này). Trả tổng SP đã dò. */
    async drain(): Promise<number> {
      const skip: string[] = [];
      let total = 0;
      for (let i = 0; i < (d.maxRounds ?? 50); i++) {
        const tid = await d.finder.next(d.now().toISOString(), skip);
        if (!tid) break;
        const n = await tenantOnce(tid);
        total += n;
        if (n === 0) skip.push(tid);
      }
      return total;
    },
    /** Tạo hàng lịch cho SP mới của nhóm có mặc định dò theo lịch (tenant cho trước). */
    materialize: (tenantId: string) =>
      d.uow.system(tenantId, (r) => r.schedule.materialize(d.now().toISOString())),
  };
}
export type ScoutScheduler = ReturnType<typeof createScoutScheduler>;
