// Luật THUẦN của file baseline `.dependency-cruiser-known-violations.json`: định dạng ổn định (sắp theo luật·from·to, bỏ trùng,
// khoá cố định) để diff nhỏ và hai nhánh cùng co baseline ít đụng nhau; nhận diện đầu ra depcruise chỉ có cảnh báo baseline cũ.

export const BASELINE_FILE = ".dependency-cruiser-known-violations.json";

export type BaselineEntry = {
  type: string;
  from: string;
  to: string;
  rule: { severity: string; name: string };
  /** Mục `type: "cycle"` mang đường vòng; MỌI trường khác của depcruise phải được giữ nguyên (không được bỏ). */
  [extra: string]: unknown;
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Khoá nhận diện = luật, from, to, type + toàn bộ trường lạ (vd `cycle`) ⇒ hai mục khác đường vòng không bị gộp. */
const keyOf = (e: BaselineEntry): string => {
  const { type, from, to, rule, ...extra } = e;
  return `${rule.name}\0${from}\0${to}\0${type}\0${JSON.stringify(extra)}`;
};

/** Sắp theo khoá bằng so sánh điểm mã (không phụ thuộc locale), bỏ mục trùng, khoá cố định đứng trước; KHÔNG bỏ trường nào của mục. */
export function normalizeBaseline(entries: readonly BaselineEntry[]): BaselineEntry[] {
  const seen = new Map<string, BaselineEntry>();
  for (const e of entries) seen.set(keyOf(e), e);
  return [...seen.values()]
    .sort((a, b) => cmp(keyOf(a), keyOf(b)))
    .map((e) => {
      const { type, from, to, rule, ...extra } = e;
      return { type, from, to, rule: { ...rule }, ...extra };
    });
}

/** Nội dung file: JSON 2 dấu cách + xuống dòng cuối, đã chuẩn hoá. */
export function formatBaseline(entries: readonly BaselineEntry[]): string {
  return `${JSON.stringify(normalizeBaseline(entries), null, 2)}\n`;
}

const INFO_ONLY = [
  /stale known violations/i,
  /known violations ignored/i,
  /no dependency violations found/i,
];

/** depcruise thoát ≠ 0 nhưng đầu ra chỉ có dòng thông tin/cảnh báo baseline cũ (stale) ⇒ coi là xanh. */
export function onlyStaleWarning(out: string): boolean {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 && lines.every((l) => INFO_ONLY.some((re) => re.test(l)));
}
