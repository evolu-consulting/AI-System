// V2-E · BA v2 §5.1 (bảng "Tiêu chí mặc định theo vai trò", "Thời gian và mức") · CD-02..05 · CR-096 Q1: cấu hình uy tín v2 theo
// ô nhóm SP × vai — tiêu chí (bật/tắt, trọng số, ≤ 8 tự thêm theo 3 kiểu), khoảng tính + giảm bậc thang theo độ cũ, ngưỡng mức,
// đánh giá thủ công, danh mục "Loại việc". Mặc định = số trong BA; kiểm hợp lệ trả câu lỗi tiếng Việt (422). Thuần.
export const REP_GROUPS = ["service", "goods", "referral"] as const;
export type RepGroup = (typeof REP_GROUPS)[number];
export const REP_ROLES = ["supplier", "customer", "commission_payer"] as const;
export type RepRole = (typeof REP_ROLES)[number];
/** 5 ô hợp lệ (BA: Giới thiệu chỉ có bên trả hoa hồng). */
export const REP_CELLS = [
  ["service", "supplier"],
  ["service", "customer"],
  ["goods", "supplier"],
  ["goods", "customer"],
  ["referral", "commission_payer"],
] as const satisfies readonly (readonly [RepGroup, RepRole])[];
export type CellKey = `${RepGroup}:${RepRole}`;
export const cellKey = (g: RepGroup, r: RepRole): CellKey => `${g}:${r}`;
export const isCell = (g: string, r: string): boolean =>
  REP_CELLS.some(([a, b]) => a === g && b === r);

/** Loại mốc ⇒ tiêu chí đúng hạn (BA §2: Giao hàng → Giao đúng hạn, Thu tiền → Thanh toán…, Cấp serial, Nhận hoa hồng). */
export const SCORED_MILESTONES = ["delivery", "payment", "serial", "commission"] as const;
export type ScoredMilestone = (typeof SCORED_MILESTONES)[number];
/** ontime = tỷ lệ đúng hạn một loại mốc · jobs = bình quân điểm việc ghi tay · bad_count = đếm việc xấu / 10 giao dịch · manual = sao × 20. */
export type CriterionKind = "ontime" | "jobs" | "bad_count" | "manual";
export type Criterion = {
  key: string;
  label: string;
  kind: CriterionKind;
  milestone?: ScoredMilestone | undefined;
  /** bad_count: điểm trừ mỗi lần trên 10 giao dịch. */
  penalty?: number | undefined;
  weight: number;
  enabled: boolean;
  custom: boolean;
};
export type Decay = { months: number[]; factors: number[] };
export type CellConfig = {
  criteria: Criterion[];
  window_months: number;
  decay: Decay;
  /** Điểm trừ mỗi ngày trễ của mốc lỗi do đối tác (BA: 100 − 2 × ngày). */
  late_per_day: number;
};
export type Settings = {
  good_from: number;
  fair_from: number;
  min_jobs: number;
  /** Tỷ trọng đánh giá thủ công s, % (BA: 20, tối đa 50). */
  manual_share: number;
  /** Lệch hơn số điểm này so với dữ liệu ⇒ bắt ghi lý do. */
  reason_gap: number;
  lock_period: "month";
};
export type JobType = { key: string; name: string; criterion: string; score: number; ord: number };
/** Một ô cần chấm (gửi xuống câu gom). */
export type CellParam = { grp: RepGroup; role: RepRole; cfg: CellConfig };

export const MAX_CUSTOM = 8;
export const MAX_JOB_TYPES = 50;
export const KEY_RE = /^[a-z0-9_:-]{1,60}$/;

export const BUILTIN: Record<string, Omit<Criterion, "weight" | "enabled" | "custom">> = {
  on_time_delivery: {
    key: "on_time_delivery",
    label: "Giao đúng hạn",
    kind: "ontime",
    milestone: "delivery",
  },
  serial: { key: "serial", label: "Cấp serial / kích hoạt", kind: "ontime", milestone: "serial" },
  incident: { key: "incident", label: "Xử lý sự cố", kind: "jobs" },
  price_hold: { key: "price_hold", label: "Giữ giá", kind: "jobs" },
  quality: { key: "quality", label: "Chất lượng", kind: "jobs" },
  on_time_payment: {
    key: "on_time_payment",
    label: "Thanh toán đúng hạn",
    kind: "ontime",
    milestone: "payment",
  },
  renew_via_us: { key: "renew_via_us", label: "Gia hạn qua mình", kind: "jobs" },
  reminders: { key: "reminders", label: "Ít phải nhắc", kind: "bad_count", penalty: 10 },
  debt: { key: "debt", label: "Công nợ", kind: "bad_count", penalty: 10 },
  complaints: { key: "complaints", label: "Ít khiếu nại vô lý", kind: "bad_count", penalty: 10 },
  on_time_commission: {
    key: "on_time_commission",
    label: "Trả hoa hồng đúng hạn",
    kind: "ontime",
    milestone: "commission",
  },
  reconcile: { key: "reconcile", label: "Gửi đối soát đầy đủ", kind: "jobs" },
  referral_support: { key: "referral_support", label: "Hỗ trợ khách giới thiệu", kind: "jobs" },
};

const DEFAULT_WEIGHTS: Partial<Record<CellKey, [string, number][]>> = {
  "service:supplier": [
    ["on_time_delivery", 25],
    ["serial", 25],
    ["incident", 25],
    ["price_hold", 15],
    ["quality", 10],
  ],
  "service:customer": [
    ["on_time_payment", 35],
    ["renew_via_us", 35],
    ["reminders", 15],
    ["debt", 10],
    ["complaints", 5],
  ],
  "goods:supplier": [
    ["on_time_delivery", 35],
    ["quality", 35],
    ["price_hold", 20],
    ["incident", 10],
  ],
  "goods:customer": [
    ["on_time_payment", 45],
    ["debt", 25],
    ["reminders", 15],
    ["complaints", 15],
  ],
  "referral:commission_payer": [
    ["on_time_commission", 60],
    ["reconcile", 25],
    ["referral_support", 15],
  ],
};

export const DEFAULT_DECAY: Decay = { months: [6, 12], factors: [1, 0.5, 0.2] };
/** BA: Dịch vụ có hạn 24 tháng (chứa ≥ 2 lần gia hạn); hàng hoá 12; giới thiệu 12. */
export const DEFAULT_WINDOW: Record<RepGroup, number> = { service: 24, goods: 12, referral: 12 };
export const DEFAULT_SETTINGS: Settings = {
  good_from: 85,
  fair_from: 70,
  min_jobs: 3,
  manual_share: 20,
  reason_gap: 25,
  lock_period: "month",
};

export function defaultCell(g: RepGroup, r: RepRole): CellConfig {
  const criteria = (DEFAULT_WEIGHTS[cellKey(g, r)] ?? []).map(([k, w]) => ({
    ...(BUILTIN[k] as Criterion),
    weight: w,
    enabled: true,
    custom: false,
  }));
  return { criteria, window_months: DEFAULT_WINDOW[g], decay: DEFAULT_DECAY, late_per_day: 2 };
}

const jt = (key: string, name: string, criterion: string, score: number): Omit<JobType, "ord"> => ({
  key,
  name,
  criterion,
  score,
});
/** Danh mục "Loại việc" mặc định (HD-06, CD-04): việc xấu (đếm) + việc có điểm (bình quân). */
export const DEFAULT_JOB_TYPES: JobType[] = [
  jt("complaint", "Khiếu nại vô lý", "complaints", 0),
  jt("reminded", "Phải nhắc", "reminders", 0),
  jt("debt_overdue", "Nợ quá hạn", "debt", 0),
  jt("incident_ok", "Xử lý sự cố tốt", "incident", 100),
  jt("incident_slow", "Xử lý sự cố chậm", "incident", 40),
  jt("price_kept", "Giữ giá", "price_hold", 100),
  jt("price_raised", "Tăng giá bất ngờ", "price_hold", 30),
  jt("quality_ok", "Hàng đạt chất lượng", "quality", 100),
  jt("quality_bad", "Hàng lỗi / đổi trả", "quality", 30),
  jt("renewed_us", "Gia hạn qua mình", "renew_via_us", 100),
  jt("renewed_elsewhere", "Gia hạn nơi khác", "renew_via_us", 0),
  jt("reconcile_ok", "Gửi đối soát đầy đủ", "reconcile", 100),
  jt("reconcile_missing", "Thiếu / chậm đối soát", "reconcile", 40),
  jt("referral_help", "Hỗ trợ khách giới thiệu", "referral_support", 100),
  jt("referral_nohelp", "Không hỗ trợ khách", "referral_support", 30),
].map((x, i) => ({ ...x, ord: i }));

/** Khoá tiêu chí tự thêm từ nhãn (bỏ dấu, gạch nối). */
export function customKey(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `custom:${slug || "x"}`;
}

const int = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

function criterionProblem(c: Criterion): string | null {
  if (!c.label.trim() || c.label.length > 60) return "Tên tiêu chí 1–60 ký tự";
  if (!int(c.weight, 0, 100)) return "Trọng số là số nguyên 0–100";
  if (!c.custom) {
    const b = BUILTIN[c.key];
    if (!b || b.kind !== c.kind || b.milestone !== c.milestone)
      return `Tiêu chí có sẵn không đổi kiểu: ${c.label}`;
  } else if (!/^custom:[a-z0-9-]{1,40}$/.test(c.key)) return `Khoá tiêu chí tự thêm sai: ${c.key}`;
  if (c.kind === "ontime" && !c.milestone) return `Tiêu chí đúng hạn cần loại mốc: ${c.label}`;
  if (c.kind === "bad_count" && !int(c.penalty ?? -1, 1, 100)) return `Mức trừ 1–100: ${c.label}`;
  if (c.custom && c.kind === "jobs")
    return "Tiêu chí tự thêm chỉ có 3 kiểu: đếm việc xấu, tỷ lệ đúng hạn, chấm tay";
  return null;
}

function decayProblem(d: Decay, window: number): string | null {
  const { months: m, factors: f } = d;
  if (m.length > 3 || f.length !== m.length + 1)
    return "Giảm theo độ cũ: tối đa 3 mốc tháng, hệ số nhiều hơn mốc một";
  if (m.some((x, i) => !int(x, 1, window) || (i > 0 && x <= (m[i - 1] as number))))
    return "Mốc tháng tăng dần, trong khoảng tính điểm";
  if (f.some((x) => !(x > 0 && x <= 1))) return "Hệ số độ cũ trong (0; 1]";
  return null;
}

/** Ô cấu hình sai ⇒ câu lỗi; đúng ⇒ null. */
export function cellProblem(c: CellConfig): string | null {
  if (!int(c.window_months, 1, 36)) return "Khoảng tính điểm 1–36 tháng";
  if (!(c.late_per_day >= 0 && c.late_per_day <= 100)) return "Điểm trừ mỗi ngày trễ 0–100";
  const keys = new Set(c.criteria.map((x) => x.key));
  if (keys.size !== c.criteria.length) return "Tiêu chí trùng nhau";
  if (c.criteria.filter((x) => x.custom).length > MAX_CUSTOM)
    return `Tối đa ${MAX_CUSTOM} tiêu chí tự thêm`;
  for (const x of c.criteria) {
    const p = criterionProblem(x);
    if (p) return p;
  }
  const on = c.criteria.filter((x) => x.enabled);
  if (!on.length) return "Cần ít nhất một tiêu chí bật";
  if (on.reduce((s, x) => s + x.weight, 0) !== 100)
    return "Tổng trọng số tiêu chí bật phải đúng 100%";
  return decayProblem(c.decay, c.window_months);
}

export function settingsProblem(s: Settings): string | null {
  if (!int(s.good_from, 1, 100) || !int(s.fair_from, 0, 99) || s.fair_from >= s.good_from)
    return "Ngưỡng: 0 ≤ KHÁ < TỐT ≤ 100";
  if (!int(s.min_jobs, 0, 100)) return "Số việc tối thiểu 0–100";
  if (!int(s.manual_share, 0, 50)) return "Tỷ trọng đánh giá thủ công 0–50%";
  if (!int(s.reason_gap, 0, 100)) return "Ngưỡng phải ghi lý do 0–100 điểm";
  return null;
}

export function jobTypesProblem(items: JobType[]): string | null {
  if (items.length > MAX_JOB_TYPES) return `Tối đa ${MAX_JOB_TYPES} loại việc`;
  if (new Set(items.map((x) => x.key)).size !== items.length) return "Loại việc trùng khoá";
  for (const x of items) {
    if (!KEY_RE.test(x.key) || !KEY_RE.test(x.criterion)) return `Khoá loại việc sai: ${x.key}`;
    if (!x.name.trim() || x.name.length > 80) return "Tên loại việc 1–80 ký tự";
    if (!int(x.score, 0, 100)) return "Điểm việc 0–100";
  }
  return null;
}
