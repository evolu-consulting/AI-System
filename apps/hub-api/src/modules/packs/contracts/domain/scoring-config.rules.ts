// HD8-FR-03 · HD8-FR-04 · port NGUYÊN `mgmt-app/api/app/scoring/{config,labels}.py` + `service._summary`: cấu hình điểm uy tín
// theo vai (tiêu chí có sẵn / tự chấm, trọng số, quy tắc chung), câu lỗi đúng chữ mgmt (`problem`), tóm tắt lịch sử. Thuần.
export type Role = "customer" | "supplier";
export type Kind = "auto" | "manual";
export type Criterion = {
  key: string;
  kind: Kind;
  label: string;
  enabled: boolean;
  weight: number;
};
export type Rules = {
  good_from: number;
  fair_from: number;
  min_events: number;
  window_months: number;
  recency_boost: boolean;
  recency_months: number;
  manual_adjust: boolean;
};
export type ScoreConfig = {
  role: Role;
  version: number;
  criteria: Criterion[];
  rules: Rules;
  updated_by: string | null;
  updated_at: string | null;
};
/** Tiêu chí như người dùng gửi (mgmt `Criterion`: key/kind/label tuỳ chọn). */
export type CriterionIn = {
  key?: string | null;
  kind?: string | null;
  label?: string | null;
  enabled: boolean;
  weight: number;
};

export const RULES: Rules = {
  good_from: 80,
  fair_from: 60,
  min_events: 3,
  window_months: 12,
  recency_boost: true,
  recency_months: 3,
  manual_adjust: true,
};
export const MAX_CRITERIA = 12;
export const MAX_LABEL = 60;
const CUSTOM = "custom:";
const CUSTOM_KEY = /^custom:[a-z0-9-]{1,40}$/;

export const LABEL: Record<string, string> = {
  payment_on_time: "Thanh toán đúng hạn",
  cks_renewal: "Gia hạn chữ ký số",
  reminders: "Số lần phải nhắc",
  appointments: "Giữ lịch hẹn",
  tenure: "Gắn bó",
  complaints: "Khiếu nại, tranh chấp",
  delivery_on_time: "Giao hàng đúng hạn",
  price: "Giá cạnh tranh",
};

const DEFAULTS: Record<Role, [string, number][]> = {
  customer: [
    ["payment_on_time", 35],
    ["cks_renewal", 20],
    ["reminders", 15],
    ["appointments", 10],
    ["tenure", 10],
    ["complaints", 10],
  ],
  supplier: [
    ["delivery_on_time", 40],
    ["complaints", 20],
    ["reminders", 10],
    ["tenure", 10],
    ["price", 20],
  ],
};

export const MANUAL_CHOICES: Record<Role, string[]> = {
  supplier: [
    "Chất lượng hàng",
    "Đóng gói, bảo quản",
    "Chứng từ, hoá đơn đầy đủ",
    "Hỗ trợ sau bán",
    "Tốc độ phản hồi",
    "Linh hoạt điều khoản",
    "Thái độ phục vụ",
    "Đáp ứng đơn gấp",
  ],
  customer: [
    "Thái độ hợp tác",
    "Tốc độ phản hồi",
    "Chứng từ, hoá đơn đầy đủ",
    "Tiềm năng mua thêm",
    "Mức độ gắn bó",
    "Dễ làm việc",
    "Giới thiệu khách mới",
  ],
};

/** `resolve.search_form`: NFD, bỏ dấu, chữ thường, cắt khoảng trắng, "đ" → "d". */
export function searchForm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/đ/g, "d");
}

/** `choice_key`: "Chất lượng hàng" → "custom:chat-luong-hang" (cùng lựa chọn luôn cùng khoá). Danh sách cố định ⇒ không rỗng. */
export function choiceKey(label: string): string {
  const slug = searchForm(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return CUSTOM + (slug || "x");
}

function criterion(c: CriterionIn): Criterion {
  const manual = c.kind === "manual" || (c.key ?? "").startsWith(CUSTOM);
  let label = (c.label ?? "").trim() || null;
  const key = c.key || (manual && label ? choiceKey(label) : `${CUSTOM}x`);
  if (!manual) label = LABEL[key] ?? key; // tiêu chí có sẵn giữ tên của nó
  return {
    key,
    kind: manual ? "manual" : "auto",
    label: label ?? "",
    enabled: Boolean(c.enabled),
    weight: c.weight,
  };
}

/** `normalise`: mỗi tiêu chí có kind + nhãn. */
export const normalise = (criteria: readonly CriterionIn[]): Criterion[] => criteria.map(criterion);

export function defaultConfig(role: Role): ScoreConfig {
  return {
    role,
    version: 0,
    rules: { ...RULES },
    updated_by: null,
    updated_at: null,
    criteria: normalise(DEFAULTS[role].map(([key, weight]) => ({ key, enabled: true, weight }))),
  };
}

export const autoKeys = (role: Role): Set<string> => new Set(DEFAULTS[role].map(([k]) => k));

/** `restorable`: tiêu chí có sẵn đã bị xoá, kèm trọng số mặc định. */
export function restorable(role: Role, criteria: readonly Criterion[]) {
  const have = new Set(criteria.map((c) => c.key));
  return DEFAULTS[role]
    .filter(([k]) => !have.has(k))
    .map(([key, weight]) => ({ key, label: LABEL[key] as string, weight }));
}

const casefold = (s: string) => s.toLowerCase();

/** Lỗi của MỘT tiêu chí (khoá, tên) — chưa xét trùng tên. */
function oneProblem(role: Role, c: Criterion): string | null {
  if (c.kind === "manual" && !CUSTOM_KEY.test(c.key)) return "Mã tiêu chí không hợp lệ";
  if (c.kind === "auto" && !autoKeys(role).has(c.key))
    return `Tiêu chí có sẵn không hợp lệ: ${c.key}`;
  if (!c.label) return "Tên tiêu chí không được để trống";
  if (c.kind === "manual" && !MANUAL_CHOICES[role].includes(c.label))
    return `Chọn tiêu chí tự chấm trong danh sách: ${c.label} không có`;
  if (c.label.length > MAX_LABEL) return `Tên tiêu chí tối đa ${MAX_LABEL} ký tự`;
  return null;
}

function criterionProblem(role: Role, crit: readonly Criterion[]): string | null {
  const seen = new Set<string>();
  for (const c of crit) {
    const bad = oneProblem(role, c);
    if (bad) return bad;
    if (seen.has(casefold(c.label))) return `Tên tiêu chí bị trùng: ${c.label}`;
    seen.add(casefold(c.label));
  }
  return null;
}

/** `problem`: vì sao không lưu được (đúng chữ trang hiển thị); null khi được. Thứ tự kiểm như mgmt. */
export function problem(role: Role, crit: readonly Criterion[], rules: Rules): string | null {
  if (crit.length > MAX_CRITERIA) return `Tối đa ${MAX_CRITERIA} tiêu chí`;
  if (new Set(crit.map((c) => c.key)).size !== crit.length) return "Tiêu chí bị trùng";
  const bad = criterionProblem(role, crit);
  if (bad) return bad;
  if (crit.some((c) => !Number.isInteger(c.weight) || c.weight < 0 || c.weight > 100))
    return "Trọng số phải từ 0 đến 100";
  if (!crit.some((c) => c.enabled)) return "Cần bật ít nhất một tiêu chí";
  if (crit.filter((c) => c.enabled).reduce((s, c) => s + c.weight, 0) !== 100)
    return "Tổng trọng số phải đúng 100%";
  if (!(0 < rules.fair_from && rules.fair_from < rules.good_from && rules.good_from <= 100))
    return "Mức Tốt phải cao hơn mức Khá";
  if (
    !(1 <= rules.window_months && rules.window_months <= 60) ||
    !(1 <= rules.recency_months && rules.recency_months <= rules.window_months)
  )
    return "Khoảng thời gian không hợp lệ";
  if (!(0 <= rules.min_events && rules.min_events <= 100))
    return "Số sự kiện tối thiểu không hợp lệ";
  return null;
}

/** Python `str(v)` của giá trị quy tắc trong tóm tắt (True/False/None như mgmt). */
const py = (v: unknown): string =>
  v === true ? "True" : v === false ? "False" : v == null ? "None" : String(v);

/** Đổi gì ở một tiêu chí (thêm / đổi tên / bật-tắt / trọng số). */
function changed(o: Criterion | undefined, c: Criterion): string[] {
  if (!o) return [`thêm ${c.label} ${c.weight}%`];
  const out: string[] = [];
  if (o.label !== c.label) out.push(`đổi tên ${o.label} → ${c.label}`);
  if (o.enabled !== c.enabled) out.push(`${c.enabled ? "bật" : "tắt"} ${c.label}`);
  else if (c.enabled && o.weight !== c.weight) out.push(`${c.label} ${o.weight}→${c.weight}%`);
  return out;
}

/** `service._summary`: đổi gì, một dòng cho danh sách lịch sử. */
export function summary(
  before: { criteria: readonly Criterion[]; rules: Rules },
  after: { criteria: readonly Criterion[]; rules: Rules },
): string {
  const b = new Map(before.criteria.map((c) => [c.key, c]));
  const now = new Set(after.criteria.map((c) => c.key));
  const parts = before.criteria.filter((c) => !now.has(c.key)).map((c) => `xoá ${c.label}`);
  for (const c of after.criteria) parts.push(...changed(b.get(c.key), c));
  for (const [k, v] of Object.entries(after.rules)) {
    const was = (before.rules as Record<string, unknown>)[k];
    if (was !== v) parts.push(`${k} ${py(was)}→${py(v)}`);
  }
  return parts.join(", ") || "lưu lại, không đổi";
}
