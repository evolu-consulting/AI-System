// CR-178 · M3 · luật thuần của «Tìm tin nhắn», «Ảnh & tệp» và «Xem trước»: tô sáng theo `match`, gộp trang, chia ảnh theo tháng,
// chọn kiểu xem trước theo mime (svg/html KHÔNG bao giờ render), chuyển ‹ ›, nhảy giữa kết quả, ghép trang tin quanh `around_seq`.
import type { MessagePage, MsgAttachment, MsgSearchHit } from "@ai/contracts/pack-contracts";
import { foldText } from "./format";
import type { MsgPages } from "./message-pages";

export type Highlighted = { before: string; hit: string; after: string };

/** Cắt đoạn trích thành 3 phần quanh chỗ khớp; `match` null / ngoài đoạn / rỗng ⇒ không tô (cả đoạn là `before`). */
export function highlightParts(
  snippet: string,
  match: { start: number; end: number } | null,
): Highlighted {
  if (!match || match.start >= match.end || match.end > snippet.length)
    return { before: snippet, hit: "", after: "" };
  return {
    before: snippet.slice(0, match.start),
    hit: snippet.slice(match.start, match.end),
    after: snippet.slice(match.end),
  };
}

/** Gộp các trang kết quả (đã mới nhất trước), bỏ trùng theo (cuộc, seq) — tải dần/làm mới không lặp dòng. */
export function mergeSearchPages(
  pages: readonly { items: readonly MsgSearchHit[] }[],
): MsgSearchHit[] {
  const seen = new Set<string>();
  const out: MsgSearchHit[] = [];
  for (const p of pages)
    for (const h of p.items) {
      const k = `${h.conversation_id}:${h.seq}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(h);
      }
    }
  return out;
}

/** Gộp các trang «Ảnh & tệp» (bỏ trùng theo tệp + tin chứa nó). */
export function mergeAttachPages(
  pages: readonly { items: readonly MsgAttachment[] }[],
): MsgAttachment[] {
  const seen = new Set<string>();
  const out: MsgAttachment[] = [];
  for (const p of pages)
    for (const a of p.items) {
      const k = `${a.file.id}:${a.seq}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
  return out;
}

/** Khoá tháng địa phương `YYYY-MM`. */
export const monthKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export type MonthGroup = { month: string; items: MsgAttachment[] };
/** Chia theo tháng giữ thứ tự (mới nhất trước); tháng tách đôi giữa hai trang vẫn là MỘT nhóm. */
export function groupByMonth(items: readonly MsgAttachment[]): MonthGroup[] {
  const out: MonthGroup[] = [];
  for (const a of items) {
    const month = monthKey(a.at);
    const last = out[out.length - 1];
    if (last?.month === month) last.items.push(a);
    else out.push({ month, items: [a] });
  }
  return out;
}

/** Ô lọc tên tệp trong «Tệp»: lọc trên phần đã tải, không phân biệt hoa/dấu. */
export function filterByName(items: readonly MsgAttachment[], q: string): MsgAttachment[] {
  const k = foldText(q.trim());
  return k ? items.filter((a) => foldText(a.file.name).includes(k)) : [...items];
}

export type PreviewKind = "image" | "pdf" | "none";
const RASTER = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Xem được trong trang: ảnh raster (png/jpg/gif/webp) và PDF. svg, html, Word, Excel, ZIP… ⇒ `none` (chỉ «Tải về»). */
export function previewKind(mime: string): PreviewKind {
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (RASTER.has(m)) return "image";
  if (m === "application/pdf") return "pdf";
  return "none";
}

/** ‹ › trong danh sách: không vòng; ngoài biên ⇒ null. */
export function stepIndex(i: number, len: number, dir: -1 | 1): number | null {
  const n = i + dir;
  return n >= 0 && n < len ? n : null;
}

/** ↑↓ / Enter giữa các tin khớp trong một cuộc: vòng quanh. «2/5» = vị trí + 1. */
export function cycleIndex(i: number, len: number, dir: -1 | 1): number {
  return len <= 0 ? 0 : (i + dir + len) % len;
}

/** Trang tin quanh `around_seq` ⇒ dữ liệu mới (thay hẳn) của danh sách tin; param `{around}` để làm mới lại đúng trang này. */
export type AroundParam = { around: number };
export function resetAround(page: MessagePage, seq: number): MsgPages & { pageParams: unknown[] } {
  return { pages: [{ items: page.items, has_more: page.has_more }], pageParams: [{ around: seq }] };
}

/** Thêm trang tin MỚI hơn lên đầu (trang đầu = mới nhất); trang cuối vẫn là cũ nhất ⇒ «tải thêm cũ» không đổi. */
export function prependNewer(
  data: (MsgPages & { pageParams: unknown[] }) | undefined,
  page: MessagePage,
  fromSeq: number,
): MsgPages & { pageParams: unknown[] } {
  const first = { items: page.items, has_more: page.has_more };
  if (!data) return { pages: [first], pageParams: [{ around: fromSeq }] };
  return {
    pages: [first, ...data.pages],
    pageParams: [{ around: fromSeq }, ...data.pageParams],
  };
}

export const maxSeq = (items: readonly { seq: number }[]): number =>
  items.reduce((m, x) => (x.seq > m ? x.seq : m), 0);

/** Tên tệp dài ⇒ cắt Ở GIỮA, giữ đuôi (`bao-gia…2026.pdf`): người đọc vẫn thấy loại tệp. */
export function midTruncate(name: string, max = 34): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const stem = name.slice(0, name.length - ext.length);
  const keep = Math.max(4, max - ext.length - 1);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${stem.slice(0, head)}…${tail > 0 ? stem.slice(-tail) : ""}${ext}`;
}
