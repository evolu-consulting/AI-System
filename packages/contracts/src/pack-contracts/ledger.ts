// HD7-FR-03…10 · HD7 plan §2/§4 · D7-06 · D7-07 · D7-19: contract zod sổ thanh toán (`/pack/contracts/{payments,obligations,
// partner-events}`, `/contracts/:id/{schedule,partner}`). Tiền = số nguyên đồng 0…10¹⁵ (an toàn JS); tổng trong `stats` = chuỗi
// thập phân (NUMERIC). Thân vào strict (khoá lạ như `tenant_id` ⇒ 400).
import { z } from "zod";
import { nfcText } from "./fields";

export const LEDGER_MONEY_MAX = 1_000_000_000_000_000;
export const LedgerMoney = z.number().int().min(0).max(LEDGER_MONEY_MAX);
export const LEDGER_SCHEDULE_MAX = 120;
export const LEDGER_LIST_MAX = 500;
export const PAYMENT_FILTERS = ["all", "receive", "pay", "overdue", "done"] as const;
export const OBLIGATION_KINDS = ["payment", "delivery"] as const;
/** V2-A: loại đợt trong DB (mốc 7 loại BA: Thu tiền/Thanh toán = `payment` theo hướng; 4 loại mới). */
export const OBLIGATION_DB_KINDS = [
  ...OBLIGATION_KINDS,
  "commission",
  "serial",
  "renewal",
  "other",
] as const;
export const OBLIGATION_STATUSES = ["open", "done", "cancelled"] as const;
export const PARTNER_ROLES = ["customer", "supplier"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];
/** Việc ghi tay được (`types.MANUAL_TYPES`); phần còn lại do nút trên đợt, CKS hoặc hệ thống ghi. */
export const MANUAL_EVENT_TYPES = [
  "appointment_kept",
  "appointment_missed",
  "delivered",
  "complaint",
  "manual_adjust",
] as const;

/** Mã lỗi riêng sổ thanh toán → HTTP (như mgmt-app). */
export const LEDGER_ERRORS = {
  OBLIGATION_DONE: 409,
  POSTPONE_DATE: 422,
  EVENT_SYSTEM: 422,
  EVENT_TYPE: 422,
  ADJUST_INVALID: 422,
} as const;
export type LedgerErrorCode = keyof typeof LEDGER_ERRORS;

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Ngày lịch `YYYY-MM-DD` có thật (không nhận 2026-02-30). */
/** Khoá/tham số giữ nguyên chữ, không rỗng, cấm NUL (Postgres từ chối NUL ⇒ 500). */
const keyStr = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !v.includes("\u0000"), { message: "NUL không được phép" });
export const IsoDay = z
  .string()
  .regex(ISO_DATE)
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return y >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }, "invalid date");

// ---------- vào ----------
export const ScheduleRowSchema = z.strictObject({
  due_date: IsoDay,
  amount: LedgerMoney.nullish().transform((v) => v ?? null),
  kind: z.enum(OBLIGATION_KINDS).default("payment"),
});
export const ScheduleRequestSchema = z.strictObject({
  rows: z.array(ScheduleRowSchema).max(LEDGER_SCHEDULE_MAX),
});
export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;
export const SettleRequestSchema = z.strictObject({
  at: IsoDay.nullish(),
  amount: LedgerMoney.nullish(),
  /** V2-A · BA §2: mốc trễ ⇒ lỗi do ai (chỉ lỗi đối tác trừ điểm); trễ mà để trống ⇒ `unknown`; đúng hạn ⇒ bỏ qua. */
  fault: z.enum(["partner", "ours", "unknown"]).nullish(),
});
export const PostponeRequestSchema = z.strictObject({
  to: IsoDay,
  note: nfcText(500).nullish(),
});
export const RemindRequestSchema = z.strictObject({});
export const PartnerEventCreateSchema = z.strictObject({
  party: keyStr(300),
  role: z.enum(PARTNER_ROLES),
  type: keyStr(40),
  at: IsoDay.nullish(),
  days_late: z.number().int().min(0).max(36_500).nullish(),
  delta: z.number().int().min(-100).max(100).nullish(),
  note: nfcText(500).nullish(),
  contract_id: z.uuid().nullish(),
});
export type PartnerEventCreate = z.infer<typeof PartnerEventCreateSchema>;

export const PaymentsQuerySchema = z.strictObject({
  filter: z.enum(PAYMENT_FILTERS).default("all"),
});
export const ObligationsQuerySchema = z.strictObject({
  contract_id: z.uuid().optional(),
  party: keyStr(300).optional(),
  status: z.enum(OBLIGATION_STATUSES).optional(),
  direction: z.enum(["pay", "receive"]).optional(),
  due_before: IsoDay.optional(),
});
export const PartnerEventsQuerySchema = z.strictObject({
  party: keyStr(300),
  role: z.enum(PARTNER_ROLES).optional(),
});

// ---------- ra ----------
export type Obligation = {
  id: string;
  contract_id: string;
  party: string | null;
  direction: "pay" | "receive";
  kind: (typeof OBLIGATION_DB_KINDS)[number];
  seq: number;
  due_date: string;
  amount: number | null;
  status: (typeof OBLIGATION_STATUSES)[number];
  done_at: string | null;
  postponed_to: string | null;
  postpones: number;
  reminders: number;
  source: "manual" | "ai" | "default" | "cks";
  estimated: boolean;
  basis: string | null;
  contract_number?: string | null;
};
/** Hàng bảng Thanh toán (`payments.board`): `party` = TÊN đối tác như mgmt-app, khoá đối tác ở `party_key`. */
export type PaymentRow = Omit<Obligation, "party" | "contract_number"> & {
  party_key: string | null;
  party: string | null;
  of: number;
  contract_title: string | null;
  days_late: number;
};
/** Tổng tiền = chuỗi thập phân đồng (D7-07). */
export type PaymentsOut = {
  stats: {
    receive_open: string;
    pay_open: string;
    overdue_count: number;
    overdue_amount: string;
    due_7d: string;
  };
  rows: PaymentRow[];
  total: number;
};
export type PartnerEvent = {
  id: string;
  party: string;
  role: (typeof PARTNER_ROLES)[number];
  type: string;
  at: string;
  by: string | null;
  /** HD8: tên hiển thị người ghi (cùng tenant, `contracts.user_label`); hệ thống ⇒ null. */
  by_name: string | null;
  source: "action" | "assistant" | "system";
  contract_id: string | null;
  obligation_id: string | null;
  days_late: number | null;
  amount: number | null;
  note: string | null;
  voided: boolean;
  voided_by: string | null;
  voided_at: string | null;
  to?: string;
  was?: string;
  due_date?: string;
  party_late?: boolean;
  kind?: string;
  seq?: number;
  delta?: number;
  /** HD8: chấm điểm tay (`type = rating`) */
  criterion?: string;
  value?: number;
  rated_at?: string;
  /** HD8: CKS (`cks_renewed`) */
  days_before_expiry?: number;
  with_us?: boolean;
};
export type ContractPartner = {
  party: string | null;
  role: (typeof PARTNER_ROLES)[number];
  name: string | null;
};
