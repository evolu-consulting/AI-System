// CR-125 c4 · luật thuần của `bun run check:date-input`: MỘT ô ngày cho mọi web (`@ai/web-kit/ui/DateInput`, dd/mm/yyyy) ⇒
// cấm `<input type="date">` / `type="datetime-local"` (hiện mm/dd theo máy Mỹ) trong mã giao diện, trừ chính component dùng chung.

export const SHARED_DATE_INPUT = "packages/web-kit/src/ui/DateInput.tsx";

const NATIVE = /\btype=(?:"|'|\{\s*["'`])(?:date|datetime-local)\b/;

export type DateInputIssue = { file: string; line: number; text: string };

/** Mỗi dòng dùng `type="date"` / `type="datetime-local"` (JSX) trong file `.tsx` không phải test và không phải component chung. */
export function nativeDateIssues(files: ReadonlyMap<string, string>): DateInputIssue[] {
  const out: DateInputIssue[] = [];
  for (const [file, src] of files) {
    if (!file.endsWith(".tsx") || file.endsWith(".test.tsx") || file === SHARED_DATE_INPUT)
      continue;
    src.split("\n").forEach((text, i) => {
      if (NATIVE.test(text)) out.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return out;
}
