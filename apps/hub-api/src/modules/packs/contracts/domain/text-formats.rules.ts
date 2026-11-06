// CR-122 p9 · FLOW2-FR-27: tệp dạng chữ (txt, csv, tsv, html, rtf, xml, json) ⇒ lấy chữ gửi AI như văn bản. Thuần, không thư viện.
// Chỉ nhận khi đuôi khai báo thuộc danh sách VÀ nội dung là UTF-8 hợp lệ không có byte NUL (tệp nhị phân đổi tên không lọt).

const TEXT_EXT = /\.(txt|csv|tsv|html?|rtf|xml|json)$/i;
/** Trần chữ lấy ra (khớp trần chữ PDF). */
export const TEXT_MAX_CHARS = 5_000_000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Gom khoảng trắng thừa, bỏ dòng trống lặp. */
const tidy = (s: string): string =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** XML/HTML ⇒ chữ: bỏ script/style/chú thích, cuối khối ⇒ xuống dòng, bỏ thẻ, giải mã thực thể thường gặp. */
export function markupToText(src: string): string {
  const s = src
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|br|a:p|text:p|text:h|row|si)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return tidy(s);
}

/** RTF ⇒ chữ: `\uN` và `\'xx` ⇒ ký tự, `\par` ⇒ xuống dòng, bỏ nhóm đích (`{\*…}`), lệnh điều khiển và ngoặc. */
export function rtfToText(src: string): string {
  const s = src
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\u(-?\d+)\??/g, (_, n) =>
      String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)),
    )
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\(?:par|line|row)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
  return tidy(s);
}

const convert = (ext: string, raw: string): string => {
  if (/^html?$|^xml$/.test(ext)) return markupToText(raw);
  return ext === "rtf" ? rtfToText(raw) : tidy(raw);
};

/** Tệp chữ hợp lệ ⇒ chữ (≤ TEXT_MAX_CHARS); không phải/trống ⇒ null. */
export function plainText(bytes: Uint8Array, name: string): string | null {
  const ext = TEXT_EXT.exec(name)?.[1]?.toLowerCase();
  if (!ext || bytes.length === 0 || bytes.includes(0)) return null;
  try {
    const text = convert(ext, utf8.decode(bytes).replace(/^﻿/, ""));
    return text ? text.slice(0, TEXT_MAX_CHARS) : null;
  } catch {
    return null;
  }
}
