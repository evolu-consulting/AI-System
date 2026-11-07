// Luật THUẦN của file baseline `.dependency-cruiser-known-violations.json`: định dạng ổn định (sắp theo luật·from·to, bỏ trùng,
// khoá cố định) để diff nhỏ và hai nhánh cùng co baseline ít đụng nhau; nhận diện đầu ra depcruise chỉ có cảnh báo baseline cũ.

export const BASELINE_FILE = ".dependency-cruiser-known-violations.json";

export type BaselineEntry = {
  type: string;
  from: string;
  to: string;
  rule: { severity: string; name: string };
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (e: BaselineEntry): string => `${e.rule.name}\0${e.from}\0${e.to}\0${e.type}`;

/** Sắp theo (luật, from, to, type) bằng so sánh điểm mã (không phụ thuộc locale), bỏ mục trùng, đặt lại thứ tự khoá. */
export function normalizeBaseline(entries: readonly BaselineEntry[]): BaselineEntry[] {
  const seen = new Map<string, BaselineEntry>();
  for (const e of entries) seen.set(keyOf(e), e);
  return [...seen.values()]
    .sort((a, b) => cmp(keyOf(a), keyOf(b)))
    .map((e) => ({
      type: e.type,
      from: e.from,
      to: e.to,
      rule: { severity: e.rule.severity, name: e.rule.name },
    }));
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
