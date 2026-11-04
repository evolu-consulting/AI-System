// DOC-ui-list · R31/R32/R33/R51: luật thuần của danh sách "Hợp đồng & giao dịch" — bộ lọc loại chứng từ (Tất cả / HĐ nguyên tắc /
// HĐ kinh tế / Giao dịch), tham số API (`nest=1`, `doc_type`), dựng hàng hiển thị (con thụt dưới HĐ NT). Không React, không fetch.
import type { ContractListResponse, DocType } from "@ai/contracts";

export const DOC_FILTERS = ["all", "framework", "contract", "deal"] as const;
export type DocFilter = (typeof DOC_FILTERS)[number];
/** Các loại có ô đếm riêng (không gồm "Tất cả"). */
export const COUNTED_TYPES: readonly DocType[] = ["framework", "contract", "deal"];

/** Giá trị `?type=` trên URL; lạ ⇒ Tất cả. */
export function parseDocFilter(v: unknown): DocFilter {
  return (DOC_FILTERS as readonly unknown[]).includes(v) ? (v as DocFilter) : "all";
}

/**
 * Tham số loại gửi API. Tất cả / HĐ nguyên tắc ⇒ `nest=1` (con thụt dưới cha; `doc_type=framework` chỉ lấy cha). HĐ kinh tế / Giao dịch ⇒
 * `doc_type` phẳng, KHÔNG `nest` (lọc theo loại thì con phải đứng riêng, không bị gom vào HĐ NT không nằm trong bộ lọc).
 */
export function docTypeParams(f: DocFilter): [string, string][] {
  if (f === "all") return [["nest", "1"]];
  if (f === "framework")
    return [
      ["doc_type", "framework"],
      ["nest", "1"],
    ];
  return [["doc_type", f]];
}

/** Đếm theo loại: một truy vấn `page_size=1` mỗi loại (chỉ đọc `total`). */
export const countQuery = (t: DocType): string =>
  new URLSearchParams([
    ["doc_type", t],
    ["page", "1"],
    ["page_size", "1"],
  ]).toString();

type Item = ContractListResponse["items"][number];
export type ListFrameChild = NonNullable<ContractListResponse["children"]>[number];
export type DocRow =
  | { kind: "item"; item: Item; doc: DocType }
  | { kind: "child"; child: ListFrameChild; orphan: boolean };

/** Lấy (và bỏ khỏi bảng) con của HĐ NT `id`; `id` null ⇒ không có. */
function takeChildren(kids: Map<string, ListFrameChild[]>, id: string | null): DocRow[] {
  const got = id ? (kids.get(id) ?? []) : [];
  if (id) kids.delete(id);
  return got.map((child) => ({ kind: "child", child, orphan: false }));
}

/**
 * Hàng hiển thị theo thứ tự trang: mỗi hàng cha, kế đó con của nó (khớp `frame_root_id` = `root_id` của hàng HĐ NT). Phản hồi cũ không có `docs`
 * ⇒ mọi hàng là HĐ kinh tế. Con không khớp hàng cha nào trong trang (cha ở trang khác / dữ liệu lệch) ⇒ cuối
 * danh sách, đánh dấu `orphan`, để không mất dòng nào.
 */
export function buildRows(r: ContractListResponse | undefined): DocRow[] {
  if (!r) return [];
  const docOf = new Map((r.docs ?? []).map((d) => [d.id, d.doc_type]));
  // `children.frame_root_id` = `root_id` của HĐ NT (phiên bản ≥ 2 có id ≠ root_id); phản hồi không có `root_id` ⇒ dùng id hàng.
  const rootOf = new Map((r.docs ?? []).map((d) => [d.id, d.root_id]));
  const kids = new Map<string, ListFrameChild[]>();
  for (const k of r.children ?? [])
    kids.set(k.frame_root_id, [...(kids.get(k.frame_root_id) ?? []), k]);
  const out: DocRow[] = [];
  for (const item of r.items) {
    const doc = docOf.get(item.id) ?? "contract";
    out.push({ kind: "item", item, doc });
    out.push(...takeChildren(kids, doc === "framework" ? (rootOf.get(item.id) ?? item.id) : null));
  }
  for (const group of kids.values())
    for (const child of group) out.push({ kind: "child", child, orphan: true });
  return out;
}
