// `tests/external-owned.json`: code (và test) do người khác sở hữu (vd DLC/AIDLC của rowan) — cổng của ta KHÔNG chạy test của họ
// (`test:affected` bỏ; `--include-external` để chạy khi cần). Chỉ lọc TEST thuộc path đó; đổi ở code dùng chung (hub-api processes,
// admin-web processes, i18n…) vẫn chạy test của ta như thường vì các path đó không nằm trong danh sách.
import { globToRegExp } from "./frozen.rules";

export type ExternalOwned = {
  owner: string;
  /** Glob (`**`, `*`, `?`, `{a,b}`) của thư mục/file thuộc người đó. */
  paths: string[];
  /** Regex (không phân biệt hoa/thường) áp cho đường dẫn của MỌI file test/e2e (`*.test.ts`, `tests/**`, `e2e/**`). */
  testPathPattern?: string;
};

export function parseExternalOwned(text: string): ExternalOwned[] {
  const raw = JSON.parse(text) as { entries?: unknown };
  if (!Array.isArray(raw.entries)) throw new Error("external-owned.json: thiếu mảng `entries`");
  return raw.entries.map((e: Partial<ExternalOwned>, i) => {
    if (!e.owner || !Array.isArray(e.paths))
      throw new Error(`external-owned.json: entries[${i}] cần \`owner\` và \`paths\``);
    if (e.testPathPattern) new RegExp(e.testPathPattern, "i"); // ném nếu regex hỏng
    return e as ExternalOwned;
  });
}

const norm = (p: string): string => p.replaceAll("\\", "/").replace(/^\.\//, "");
const isTestLike = (f: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /^(tests|e2e)\//.test(f);

export type ExternalMatcher = (file: string) => boolean;

/** Bộ khớp: file thuộc path của người khác, hoặc là test/e2e có `testPathPattern` khớp. */
export function externalMatcher(entries: readonly ExternalOwned[]): ExternalMatcher {
  const globs = entries.flatMap((e) => e.paths.map(globToRegExp));
  const pats = entries.flatMap((e) =>
    e.testPathPattern ? [new RegExp(e.testPathPattern, "i")] : [],
  );
  return (file) => {
    const f = norm(file);
    return globs.some((g) => g.test(f)) || (isTestLike(f) && pats.some((p) => p.test(f)));
  };
}
