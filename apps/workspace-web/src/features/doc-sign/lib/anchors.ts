// CR-181 · tự đặt chỗ ký theo chữ «ĐẠI DIỆN BÊN A/B» trong tệp. Bản mẫu dòng 748–758.
// Toạ độ item = transform của pdf.js (điểm, gốc dưới-trái). Giả định trang không xoay; trang xoay thì
// nơi gọi đổi toạ độ item về hệ trang đã xoay trước khi truyền vào.
import { SIGN_FIELD_ASPECT, type SignSide } from "@ai/contracts/pack-contracts";

export type TextItem = { str: string; transform: number[] };
export type PageText = { page: number; items: TextItem[] };
/** Ô đặt gợi ý, điểm PDF, gốc dưới-trái. */
export type AnchorBox = { page: number; x: number; y: number; w: number; h: number };
export type Anchors = Record<SignSide, AnchorBox | null>;

export const ANCHOR_PHRASES: Record<SignSide, string> = {
  A: "ĐẠI DIỆN BÊN A",
  B: "ĐẠI DIỆN BÊN B",
};
export const ANCHOR_BOX_W = 160;
/** Tâm ô nằm 75pt bên phải và 45pt dưới điểm bắt đầu cụm chữ (bản mẫu dòng 758). */
const CENTER_DX = 75;
const CENTER_DY = 45;

const norm = (s: string) => s.normalize("NFC").toUpperCase().replace(/\s+/g, "");

/** Tìm cụm (bỏ khoảng trắng) trong chuỗi ghép các item; trả item chứa ký tự đầu cụm. */
function findItem(items: TextItem[], phrase: string): TextItem | null {
  let buf = "";
  const owner: number[] = [];
  items.forEach((it, i) => {
    const s = norm(it.str ?? "");
    buf += s;
    for (let c = 0; c < s.length; c++) owner.push(i);
  });
  const at = buf.indexOf(norm(phrase));
  if (at < 0) return null;
  const idx = owner[at];
  return idx === undefined ? null : (items[idx] ?? null);
}

/** Từ trang CUỐI ngược lên; mỗi bên lấy trang đầu tiên gặp. Không thấy ⇒ null. */
export function findAnchors(pagesText: PageText[]): Anchors {
  const out: Anchors = { A: null, B: null };
  const sorted = [...pagesText].sort((a, b) => b.page - a.page);
  for (const pt of sorted) {
    for (const side of ["A", "B"] as const) {
      if (out[side]) continue;
      const it = findItem(pt.items, ANCHOR_PHRASES[side]);
      const x0 = it?.transform[4];
      const y0 = it?.transform[5];
      if (!it || x0 === undefined || y0 === undefined) continue;
      const w = ANCHOR_BOX_W;
      const h = w / SIGN_FIELD_ASPECT;
      out[side] = { page: pt.page, x: x0 + CENTER_DX - w / 2, y: y0 - CENTER_DY - h / 2, w, h };
    }
    if (out.A && out.B) break;
  }
  return out;
}
