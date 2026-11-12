// CR-127 K1a · BR-07 · spec §2.1: hiệu lực của HĐ (thay `statusOn` của `deadline.rules`). Thuần, lớp 1: `today` (ISO, theo múi giờ
// công ty) truyền vào. SQL `contracts.effect_of` / `contracts.refresh_effect` (MIGC 0091) cho CÙNG kết quả — bảng ca `EFFECT_CASES`
// dùng chung cho unit và int (`contract-state.int.test.ts`). Chỉ có hiệu lực khi `status='done'`; bản đã bị thay ⇒ không tính (null).
import { daysBetween } from "./local-time.rules";

export const CONTRACT_EFFECTS = [
  "not_started",
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
] as const;
export type ContractEffect = (typeof CONTRACT_EFFECTS)[number];
export const EFFECT_OUTCOMES = ["renewed", "terminated"] as const;
export type EffectOutcome = (typeof EFFECT_OUTCOMES)[number];

/** Ngưỡng "Sắp hết hạn" mặc định khi HĐ không có `notice_days` hợp lệ. */
export const DEFAULT_NOTICE_DAYS = 30;
const NOTICE_MAX = 3650;

/** ≡ SQL: số nguyên 0…3650 (số hoặc chuỗi chữ số) ⇒ chính nó; còn lại ⇒ 30. */
export function noticeDaysOf(v: unknown): number {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^[0-9]{1,4}$/.test(v)
        ? Number(v)
        : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= NOTICE_MAX ? n : DEFAULT_NOTICE_DAYS;
}

export type EffectFacts = {
  status: string;
  superseded: boolean;
  outcome: EffectOutcome | null;
  startDate: string | null;
  endDate: string | null;
  noticeDays?: unknown;
};

/** Thứ tự: không done / đã bị thay ⇒ null → kết cục thắng → chưa tới ngày bắt đầu → quá ngày kết thúc → còn ≤ N ngày → active. */
export function effectOf(c: EffectFacts, today: string): ContractEffect | null {
  if (c.status !== "done" || c.superseded) return null;
  if (c.outcome) return c.outcome;
  if (c.startDate !== null && c.startDate > today) return "not_started";
  if (c.endDate !== null && c.endDate < today) return "expired";
  if (c.endDate !== null && daysBetween(today, c.endDate) <= noticeDaysOf(c.noticeDays))
    return "expiring";
  return "active";
}

const base: EffectFacts = {
  status: "done",
  superseded: false,
  outcome: null,
  startDate: null,
  endDate: null,
};
const T = "2026-11-10";
/** Bảng ca chung TS ↔ SQL. */
export const EFFECT_CASES: {
  name: string;
  input: EffectFacts;
  today: string;
  want: ContractEffect | null;
}[] = [
  { name: "chưa done ⇒ null", input: { ...base, status: "draft" }, today: T, want: null },
  { name: "processing ⇒ null", input: { ...base, status: "processing" }, today: T, want: null },
  { name: "reject ⇒ null", input: { ...base, status: "reject" }, today: T, want: null },
  { name: "bản đã bị thay ⇒ null", input: { ...base, superseded: true }, today: T, want: null },
  {
    name: "kết cục gia hạn thắng ngày",
    input: { ...base, outcome: "renewed", endDate: "2020-01-01" },
    today: T,
    want: "renewed",
  },
  {
    name: "kết cục chấm dứt thắng chưa hiệu lực",
    input: { ...base, outcome: "terminated", startDate: "2030-01-01" },
    today: T,
    want: "terminated",
  },
  {
    name: "ngày bắt đầu sau hôm nay ⇒ chưa hiệu lực",
    input: { ...base, startDate: "2026-11-11", endDate: "2027-11-11" },
    today: T,
    want: "not_started",
  },
  {
    name: "bắt đầu hôm nay ⇒ đã hiệu lực",
    input: { ...base, startDate: T, endDate: "2028-01-01" },
    today: T,
    want: "active",
  },
  { name: "không ngày ⇒ active", input: base, today: T, want: "active" },
  {
    name: "kết thúc hôm qua ⇒ hết hạn",
    input: { ...base, endDate: "2026-11-09" },
    today: T,
    want: "expired",
  },
  {
    name: "kết thúc hôm nay ⇒ sắp hết hạn",
    input: { ...base, endDate: T },
    today: T,
    want: "expiring",
  },
  {
    name: "còn 30 ngày (mặc định N=30) ⇒ sắp hết hạn",
    input: { ...base, endDate: "2026-12-10" },
    today: T,
    want: "expiring",
  },
  {
    name: "còn 31 ngày ⇒ active",
    input: { ...base, endDate: "2026-12-11" },
    today: T,
    want: "active",
  },
  {
    name: "notice_days 60 ⇒ còn 45 ngày là sắp hết hạn",
    input: { ...base, endDate: "2026-12-25", noticeDays: 60 },
    today: T,
    want: "expiring",
  },
  {
    name: "notice_days '5' ⇒ còn 10 ngày là active",
    input: { ...base, endDate: "2026-11-20", noticeDays: "5" },
    today: T,
    want: "active",
  },
  {
    name: "notice_days sai ⇒ 30",
    input: { ...base, endDate: "2026-11-30", noticeDays: "abc" },
    today: T,
    want: "expiring",
  },
];
