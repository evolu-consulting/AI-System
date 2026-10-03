// C1 FE · F12 · tô màu code (ADR-0006): hljs nạp động, chỉ 10 ngôn ngữ, không `highlightAuto`.
// Màu lấy từ CSS biến `--code-*` (globals.css), không nhập theme CSS của hljs.

/** Tên gọi khác → tên ngôn ngữ đã đăng ký. */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  html: "xml",
  md: "markdown",
};
const SUPPORTED = new Set([
  "typescript",
  "javascript",
  "json",
  "bash",
  "python",
  "sql",
  "xml",
  "css",
  "yaml",
  "markdown",
]);

/** Chuẩn hoá nhãn ngôn ngữ của khối code; không hỗ trợ → `null`. */
export function resolveLanguage(label: string | undefined): string | null {
  const key = (label ?? "").trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return SUPPORTED.has(name) ? name : null;
}

/** Nạp sẵn chunk hljs (khi rảnh). */
export function preloadHighlighter(): Promise<unknown> {
  return import("./hljs-setup");
}

/** HTML đã được hljs escape (chuỗi gồm `<span class="hljs-*">`); `null` khi không tô được (ngôn ngữ lạ, lỗi nạp). */
export async function highlightToHtml(
  code: string,
  label: string | undefined,
): Promise<string | null> {
  const language = resolveLanguage(label);
  if (!language) return null;
  try {
    const { hljs } = await import("./hljs-setup");
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
