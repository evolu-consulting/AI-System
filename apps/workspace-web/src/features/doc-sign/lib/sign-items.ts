// CR-181 · mục trên màn ký (chữ ký tự do / ô chỗ ký) + thao tác thuần. Nguồn sự thật = `parts` (điểm PDF);
// px chỉ suy ra khi vẽ (rectFromParts), nên đổi cỡ cửa sổ không làm lệch.
import { SIGN_FIELD_ASPECT, type SignPart, type SignSide } from "@ai/contracts/pack-contracts";
import { copyToAllPages } from "./actions";
import { isPartsError, partsOf, type Rect, type StagePage } from "./geometry";

export type SignItemStatus = "editable" | "mine" | "other";
export type SignItem = {
  id: string;
  /** `mark` = chữ ký đặt tự do; `field` = ô chỗ ký. */
  kind: "mark" | "field";
  parts: SignPart[];
  aspect: number;
  side?: SignSide;
  /** Tên người (nhãn ô). */
  person?: string;
  status: SignItemStatus;
  /** Ảnh chữ ký (mark). */
  imageUrl?: string;
  /** s12 · id chỗ ký ở máy chủ — mark đặt vào ô ⇒ placement `field`. */
  fieldId?: string;
  /** s12 · bản «Chép sang mọi trang» ⇒ placement `initials`. */
  initials?: boolean;
};

export type NewItem = Omit<SignItem, "parts" | "id">;
let seq = 0;
export const newItemId = () => `it-${Date.now().toString(36)}-${seq++}`;

/** Thả/đặt: tính parts; quá 5 trang ⇒ null (không đặt). */
export function placeItem(items: SignItem[], spec: NewItem, rect: Rect, pages: StagePage[]) {
  const parts = partsOf(rect, pages);
  if (isPartsError(parts) || parts.length === 0) return null;
  return [...items, { ...spec, id: newItemId(), parts }];
}

export function moveItem(items: SignItem[], id: string, rect: Rect, pages: StagePage[]) {
  const parts = partsOf(rect, pages);
  if (isPartsError(parts) || parts.length === 0) return items;
  return items.map((i) => (i.id === id && i.status === "editable" ? { ...i, parts } : i));
}

export const removeItem = (items: SignItem[], id: string) =>
  items.filter((i) => !(i.id === id && i.status === "editable"));

export function setSide(items: SignItem[], id: string, side: SignSide, person?: string) {
  return items.map((i) => (i.id === id && i.kind === "field" ? { ...i, side, person } : i));
}

/** «Chép sang mọi trang» (Q11): bản thu nhỏ `scale`, bỏ trang nguồn và trang đã có chữ ký này. */
export function copyAll(
  items: SignItem[],
  id: string,
  pages: StagePage[],
  rectOf: (i: SignItem) => Rect | null,
  scale: number,
) {
  const src = items.find((i) => i.id === id);
  const r = src && rectOf(src);
  const srcPage = src?.parts[0]?.page;
  if (!src || !r || srcPage === undefined) return items;
  const out = [...items];
  for (const c of copyToAllPages(r, srcPage, pages, scale)) {
    const parts = partsOf(c.rect, pages);
    if (isPartsError(parts) || parts.length === 0) continue;
    out.push({
      ...src,
      id: newItemId(),
      parts,
      aspect: src.aspect || SIGN_FIELD_ASPECT,
      fieldId: undefined,
      initials: true,
    });
  }
  return out;
}
