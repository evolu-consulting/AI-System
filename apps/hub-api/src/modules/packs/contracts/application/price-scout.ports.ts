// price-scout · cổng của dò giá thị trường (lớp 2 — chỉ kiểu). Agent Hub `price-scout` đi qua cổng nền `lib/ai-client/agent-call`
// (adapter `adapters/price-scout.agent.ts`); repo SQL ở `adapters/price-scout.repo.ts` + `price-scout-schedule.repo.ts`.
import type {
  PriceScoutConfig,
  PriceScoutOverride,
  PriceScoutQuotaRow,
} from "../domain/price-scout.types";
import type { SupplierSearchItem } from "../domain/supplier-prices.types";

export type ScoutTrigger = "manual" | "schedule";
export type ScoutAgentReply =
  | { ok: true; text: string; tokens: number }
  | { ok: false; code: "CAP_EXCEEDED" | "UNAVAILABLE" | "FAILED" | "REFUSED" };
/** Một lượt agent dò giá (usage: app contracts, feature `contracts.price_scout`, agent, trigger, id SP). Không bao giờ ném. */
export type ScoutAgent = (req: {
  tenantId: string;
  userId: string | null;
  productId: string;
  trigger: ScoutTrigger;
  prompt: string;
  signal: AbortSignal;
}) => Promise<ScoutAgentReply>;

export type ScoutProductRow = {
  name: string;
  group: "service" | "goods" | "referral";
  /** Ghi đè riêng (đã làm sạch). */
  override: PriceScoutOverride;
  /** Mặc định nhóm đã lưu (đã làm sạch; vắng ⇒ {}). */
  group_saved: PriceScoutOverride;
  next_at: string | null;
  last_at: string | null;
  last_status: string | null;
};
export type ScoutUsageRow = { searches: number; tokens: number; quota: PriceScoutQuotaRow | null };

/** Repo trong tx tenant (RLS). */
export type ScoutRepo = {
  product(productId: string): Promise<ScoutProductRow | null>;
  saveOverride(productId: string, o: PriceScoutOverride, nextAt: string | null): Promise<boolean>;
  defaults(): Promise<Partial<Record<"service" | "goods", PriceScoutOverride>>>;
  /** Lưu mặc định nhóm + tính lại lịch mọi SP của nhóm (tạo hàng cho SP chưa có khi nhóm dò theo lịch). */
  saveDefaults(group: "service" | "goods", c: PriceScoutConfig, now: string): Promise<void>;
  usage(monthStart: string): Promise<ScoutUsageRow>;
  /** Giữ một lượt dò tay nếu còn trần tháng (một câu); false ⇒ hết trần. */
  reserveManual(today: string, monthStart: string, systemSearches: number): Promise<boolean>;
  /** Sau lượt dò tay: cộng token; `refund` ⇒ trả lượt đã giữ (không tới nhà cung cấp). */
  settleManual(today: string, tokens: number, refund: boolean): Promise<void>;
  saveQuota(q: PriceScoutQuotaRow, platform: boolean): Promise<void>;
};

/** SP đã nhận (lease) cho lượt dò theo lịch. */
export type ClaimedProduct = {
  product_id: string;
  name: string;
  override: PriceScoutOverride;
  group_saved: PriceScoutOverride;
  last_at: string | null;
  avg_cost: number | null;
  /** Giá mua mới đã lưu gần nhất theo tên NCC (thường). */
  previous: Record<string, number>;
};
export type ScoutResult = {
  product_id: string;
  status: "ok" | "empty" | "failed" | "unavailable" | "cap";
  items: SupplierSearchItem[];
  alerts: { kind: string; detail: string; supplier_name: string | null; price: number | null }[];
  tokens: number;
  next_at: string | null;
};
export type ScheduleLimits = {
  concurrency: number;
  daily: number;
  systemSearches: number;
  leaseS: number;
};
/** Repo vòng nền trong tx hệ thống của một tenant (`app.tenant_id`, không user). */
export type ScoutScheduleRepo = {
  /** MỘT câu: chọn SP tới hạn `FOR UPDATE SKIP LOCKED` (giới hạn theo lượt đang chạy + trần ngày/tháng), đặt lease, cộng bộ đếm. */
  claim(
    now: string,
    today: string,
    monthStart: string,
    l: ScheduleLimits,
  ): Promise<ClaimedProduct[]>;
  /** MỘT câu cho cả lô: lưu giá + cảnh báo + lịch kế + token, gỡ lease. */
  apply(now: string, today: string, results: ScoutResult[]): Promise<void>;
  /** SP mới của nhóm có mặc định dò theo lịch chưa có hàng cấu hình ⇒ tạo (tới hạn ngay). Một câu. */
  materialize(now: string): Promise<number>;
};
/** Tenant kế có SP tới hạn (role job, chỉ đọc cột lịch). */
export type ScoutDueFinder = { next(now: string, skip: readonly string[]): Promise<string | null> };
