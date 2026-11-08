// CR-125 c7 · luật thuần của `bun run check:shared-limits` (audit #13): giới hạn nghiệp vụ đã có hằng ở `packages/contracts`
// (nhắc 4–168 giờ, chuyển cấp 4–2160 giờ…) chỉ có MỘT nguồn.
//  R. app khai lại hằng cùng tên (ADR-0023: domain web không import @ai/contracts) ⇒ phải có test "parity" cùng app tham chiếu @ai/contracts + tên hằng.
//  L. số cứng của hằng (`max={168}`, `max: 2160`) ngoài dòng khai lại ở mã app.
//  T. chữ locale ghi lại khoảng của hằng ("4 đến 168", "4–168") thay vì {{min}}/{{max}}.

/** Hằng đã có ở contract và dễ bị chép lại; số lớn nhất của khoảng dùng bắt số cứng. */
export const TRACKED_LIMITS: Readonly<Record<string, { min: number; max: number }>> = {
  REMIND_EVERY_H: { min: 4, max: 168 },
  ESCALATE_AFTER_H: { min: 4, max: 2160 },
};
/** Chỉ kiểm chữ locale cho các hằng đã nội suy xong ({{min}}/{{max}}); chuyển cấp 4–2160 còn nợ (xem audit #13). */
export const TEXT_CHECKED = ["REMIND_EVERY_H"] as const;

export type LimitIssue = { file: string; line: number; msg: string };

const DECL = /export const ([A-Z][A-Z0-9_]*)\s*=\s*\{\s*min:/;
const isTest = (f: string) => /\.(test|spec|cs|cw|pa|fnr)\.tsx?$/.test(f);
const appOf = (f: string) => /^(apps\/[^/]+)\//.exec(f)?.[1] ?? "";

const MAX_DECL = Object.values(TRACKED_LIMITS).map((r) => new RegExp(`\\bmax:\\s*${r.max}\\b`));
const MAX_LITERAL = Object.entries(TRACKED_LIMITS).map(
  ([n, r]) => [n, r.max, new RegExp(`\\bmax\\s*(?::|=\\s*\\{)\\s*${r.max}\\b`)] as const,
);

/** Vi phạm của MỘT dòng mã (`parity` = app có test tham chiếu @ai/contracts + tên hằng). */
function lineIssues(text: string, parity: (name: string) => boolean): string[] {
  const name = DECL.exec(text)?.[1];
  if (name && MAX_DECL.some((re) => re.test(text)))
    return parity(name) ? [] : [`${name} khai lại, thiếu test parity với @ai/contracts`];
  if (/^\s*(\/\/|\*|\/\*)/.test(text)) return [];
  return MAX_LITERAL.filter(([, , re]) => re.test(text)).map(
    ([n, max]) => `số cứng ${max} của ${n} — dùng ${n}.max`,
  );
}

/** Hằng khai lại ở app + số cứng của hằng; `files` = mã nguồn trong `apps/**` (ts/tsx) gồm cả test (để tìm parity). */
export function limitIssues(files: ReadonlyMap<string, string>): LimitIssue[] {
  const out: LimitIssue[] = [];
  for (const [file, src] of files) {
    if (isTest(file) || !/\.tsx?$/.test(file)) continue;
    const app = appOf(file);
    const parity = (name: string): boolean =>
      [...files].some(
        ([f, s]) =>
          isTest(f) && appOf(f) === app && s.includes("@ai/contracts") && s.includes(name),
      );
    src.split("\n").forEach((text, i) => {
      for (const msg of lineIssues(text, parity)) out.push({ file, line: i + 1, msg });
    });
  }
  return out;
}
export type LocaleValue = { file: string; key: string; value: string };

/** Chữ locale ghi cứng khoảng của hằng đã nội suy: "4 đến 168", "4 to 168", "4–168", "4-168". */
export function textIssues(entries: readonly LocaleValue[]): LimitIssue[] {
  const out: LimitIssue[] = [];
  for (const n of TEXT_CHECKED) {
    const r = TRACKED_LIMITS[n];
    if (!r) continue;
    const re = new RegExp(`\\b${r.min}\\s*(?:đến|to|–|-)\\s*${r.max}\\b`);
    for (const e of entries)
      if (re.test(e.value))
        out.push({
          file: e.file,
          line: 0,
          msg: `${e.key}: ghi cứng ${r.min}–${r.max} — dùng {{min}}/{{max}} (${n})`,
        });
  }
  return out;
}
