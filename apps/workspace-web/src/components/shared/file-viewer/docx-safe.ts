// fix-review-r1 (BLOCKER XSS) · Word .docx do người DÙNG KHÁC tải lên ⇒ HTML dựng từ nó KHÔNG được chạy trong DOM của app.
// Thuần (không biết React/DOM thật; nhận tối thiểu giao diện Element để test không cần trình duyệt):
//  - `safeHref`: chỉ http(s):, mailto:, `#`;
//  - `sanitizeDocxDom`: gỡ phần tử nguy hiểm + mọi thuộc tính `on*`; mọi `a[href]` không an toàn ⇒ gỡ href; còn lại đặt rel/target an toàn;
//  - `safeStyles`: phần styles chỉ lấy văn bản CSS của <style> (bỏ thẻ khác, thoát `<`);
//  - `buildSrcdoc`: tài liệu HTML cho `<iframe sandbox="" srcdoc>` (không allow-scripts, không allow-same-origin; chỉ allow-popups để liên kết https mở tab mới) + CSP `default-src 'none'`.

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** `#neo`, `http(s)://…`, `mailto:…` ⇒ true. Còn lại (javascript:, data:, vbscript:, tương đối, rỗng, ký tự lạ) ⇒ false. */
export function safeHref(raw: string): boolean {
  const h = raw.trim();
  if (h.startsWith("#")) return true;
  try {
    return SAFE_PROTOCOLS.has(new URL(h).protocol); // bộ phân tích URL bỏ tab/xuống dòng ⇒ `java\nscript:` vẫn ra `javascript:`
  } catch {
    return false;
  }
}

export type DomEl = {
  getAttributeNames(): string[];
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  remove(): void;
};
export type DomRoot = { querySelectorAll(sel: string): ArrayLike<DomEl> | Iterable<DomEl> };

const DANGEROUS = "script,iframe,frame,object,embed,applet,base,meta,link,form,noscript";

export function sanitizeDocxDom(root: DomRoot): void {
  for (const el of Array.from(root.querySelectorAll(DANGEROUS))) el.remove();
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const n of el.getAttributeNames()) if (/^on/i.test(n)) el.removeAttribute(n);
  }
  for (const a of Array.from(root.querySelectorAll("a"))) {
    const href = a.getAttribute("href");
    if (href === null) continue;
    if (!safeHref(href)) {
      a.removeAttribute("href");
      continue;
    }
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("target", "_blank");
  }
}

export type StyleEl = { textContent: string | null };
export type StyleRoot = { querySelectorAll(sel: string): ArrayLike<StyleEl> | Iterable<StyleEl> };

/**
 * fix-review-r2 · phần styles của docx-preview cũng do tài liệu quyết (tên font, class…) ⇒ KHÔNG chèn innerHTML thô: chỉ lấy `textContent` của
 * từng `<style>`, bỏ mọi thẻ khác; mọi `<` trong CSS thoát thành mã CSS (hex 3c) nên không thể đóng thẻ style để chèn HTML ⇒ một `<style>` sạch.
 */
const LT_ESCAPED = `${String.fromCharCode(92)}3c `; // gạch chéo ngược + "3c" + khoảng trắng = thoát CSS của `<`
export function safeStyles(root: StyleRoot): string {
  const css = Array.from(root.querySelectorAll("style"))
    .map((el) => (el.textContent ?? "").replace(/</g, LT_ESCAPED))
    .join(String.fromCharCode(10));
  return css ? `<style>${css}</style>` : "";
}

const CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

/** `body` là HTML đã qua `sanitizeDocxDom` (innerHTML); `styles` là kết quả `safeStyles`. */
export function buildSrcdoc(body: string, styles: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>html,body{margin:0}</style>${styles}</head><body>${body}</body></html>`;
}
