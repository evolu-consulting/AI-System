// products-confirm · BA 5.5 (khách 2026-10-22): luật thuần của hộp "Gắn sản phẩm" lúc xác nhận HĐ — mỗi dòng: dùng SP có sẵn (SP
// trùng tên nhiều nhất được chọn sẵn) hoặc tạo SP mới (mặc định khi không có SP trùng). Không React, không fetch.
import type {
  ContractDeal,
  ContractItem,
  ProductGroup,
  ProductLink,
  ProductOut,
} from "@ai/contracts";
import { type LineState, NEW_PRODUCT, named } from "~/features/contract-form/lib/form-model";

export type LinkChoice = {
  item_id: string;
  item_name: string;
  unit: string | null;
  mode: "existing" | "new";
  product_id: string;
  /** SP trùng tên (tốt nhất trước); dòng đã gắn SP ⇒ SP đó đứng đầu. */
  candidates: { id: string; name: string }[];
  new_name: string;
  new_group: ProductGroup;
};

/** Gấp tiếng Việt: thường, bỏ dấu, đ ⇒ d. */
export const foldVi = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();

const words = (s: string): string[] => [
  ...new Set(
    foldVi(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  ),
];

/** Tỷ lệ từ của tên SP có mặt trong tên dòng (0…1). */
export function overlap(line: string, name: string): number {
  const ws = words(name);
  if (ws.length === 0) return 0;
  const have = new Set(words(line));
  return ws.filter((w) => have.has(w)).length / ws.length;
}

/** Đơn vị SP tối đa 40 ký tự (dòng HĐ cho tới 50). */
const unitOf = (u: string | null): string | null => u?.trim().slice(0, 40) || null;

export const MATCH_MIN = 0.5;
const MATCH_MAX = 8;

/** SP trùng tên dòng (≥ 50% từ, hoặc trùng hẳn tên), tốt nhất trước; HĐ Giới thiệu chỉ SP nhóm Giới thiệu và ngược lại. */
export function candidatesOf(
  name: string,
  deal: ContractDeal | null,
  products: readonly ProductOut[],
): ProductOut[] {
  const key = foldVi(name.trim());
  return products
    .filter((p) => !deal || (deal === "referral") === (p.group === "referral"))
    .map((p) => ({ p, s: foldVi(p.name.trim()) === key ? 2 : overlap(name, p.name) }))
    .filter((x) => x.s >= MATCH_MIN)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, MATCH_MAX)
    .map((x) => x.p);
}

const groupOf = (deal: ContractDeal | null): ProductGroup =>
  deal === "referral" ? "referral" : "goods";

/** Lựa chọn ban đầu mỗi dòng: đã gắn ⇒ giữ; có SP trùng ⇒ dùng SP tốt nhất; không ⇒ tạo mới từ tên dòng. */
export function initialChoices(
  items: readonly ContractItem[],
  products: readonly ProductOut[],
  deal: ContractDeal | null,
): LinkChoice[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return [...items]
    .sort((a, b) => a.ord - b.ord)
    .map((it) => {
      const linked = it.product_id ? byId.get(it.product_id) : undefined;
      const found = candidatesOf(it.name, deal, products).filter((p) => p.id !== linked?.id);
      const cands = (linked ? [linked, ...found] : found).map((p) => ({ id: p.id, name: p.name }));
      const first = cands[0];
      return {
        item_id: it.id,
        item_name: it.name,
        unit: it.unit,
        mode: first ? "existing" : "new",
        product_id: first?.id ?? "",
        candidates: cands,
        new_name: it.name.trim().slice(0, 300),
        new_group: groupOf(deal),
      };
    });
}

/** Lựa chọn chưa đủ (dùng SP có sẵn mà chưa chọn / tạo mới mà chưa có tên) ⇒ chặn nút xác nhận. */
export const incomplete = (cs: readonly LinkChoice[]): boolean =>
  cs.some((c) => (c.mode === "existing" ? !c.product_id : !c.new_name.trim()));

export function toLinks(cs: readonly LinkChoice[]): ProductLink[] {
  return cs.map((c) =>
    c.mode === "existing"
      ? { item_id: c.item_id, product_id: c.product_id }
      : {
          item_id: c.item_id,
          new_product: {
            name: c.new_name.trim(),
            unit: unitOf(c.unit),
            group: c.new_group,
          },
        },
  );
}

/** Form nhập tay / màn xác nhận: lưu xong HĐ đã xác nhận ⇒ dòng chọn "tạo SP mới" trong form thành link (khớp theo thứ tự dòng có
 *  tên ↔ dòng đã lưu theo `ord`). */
export function newLinksOfForm(
  lines: readonly LineState[],
  saved: readonly ContractItem[],
): ProductLink[] {
  const items = [...saved].sort((a, b) => a.ord - b.ord);
  const out: ProductLink[] = [];
  named(lines).forEach((l, j) => {
    const it = items[j];
    if (!it || l.product_id !== NEW_PRODUCT || !l.new_name.trim()) return;
    out.push({
      item_id: it.id,
      new_product: {
        name: l.new_name.trim(),
        unit: unitOf(l.unit),
        group: l.new_group,
      },
    });
  });
  return out;
}
