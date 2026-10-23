// CR-097 K2 · HD-FR-101 "Tải bản cập nhật" = phiên bản mới (nháp) cùng chuỗi · HD-FR-102 xác nhận v(n+1) ⇒ bản trước bị thay (giữ
// ngày của nó) · HD-FR-103 cutover nghĩa vụ · X5 / CR-097b xoá trong chuỗi · UC-04 so sánh trường pháp lý. Thuần (không DB).
// Phiên bản ≠ phụ lục ≠ gia hạn (decision 9). SQL theo tập ở migration 0049 (`contracts.k2_supersede`) làm đúng `cutoverPlan`.

export type ChainRow = {
  id: string;
  version_no: number;
  superseded_at: string | null;
  locked: boolean;
};

const live = (rows: readonly ChainRow[]) =>
  rows.filter((r) => r.superseded_at === null).sort((a, b) => a.version_no - b.version_no);

/** Bản hiện hành = bản chưa bị thay có `version_no` nhỏ nhất (v2 mở lại sau khi đã thay v1 vẫn là hiện hành). */
export const currentOf = (rows: readonly ChainRow[]): ChainRow | null => live(rows)[0] ?? null;

/** Nháp mở = bản chưa bị thay đứng sau bản hiện hành (tối đa 1 / chuỗi — index `contracts_open_draft_uq`). */
export const openDraftOf = (rows: readonly ChainRow[]): ChainRow | null => live(rows)[1] ?? null;

export type NewVersionVerdict =
  | "ok"
  | "NOT_FOUND"
  | "VERSION_NOT_ALLOWED"
  | "CONTRACT_SUPERSEDED"
  | "CONTRACT_NOT_LOCKED"
  | "VERSION_DRAFT_EXISTS";

/** Tải bản cập nhật cho HĐ `id`: phải thấy (RLS), là HĐ (không phụ lục), hiện hành, đã khoá, chuỗi chưa có nháp. */
export function newVersionVerdict(c: {
  found: boolean;
  kind: string;
  superseded: boolean;
  locked: boolean;
  draft: boolean;
}): NewVersionVerdict {
  if (!c.found) return "NOT_FOUND";
  if (c.kind !== "contract") return "VERSION_NOT_ALLOWED";
  if (c.superseded) return "CONTRACT_SUPERSEDED";
  if (!c.locked) return "CONTRACT_NOT_LOCKED";
  if (c.draft) return "VERSION_DRAFT_EXISTS";
  return "ok";
}

/** CR-097b: xoá được HĐ một phiên bản, hoặc bản nháp mở của chuỗi (= bỏ bản cập nhật); còn lại 409. */
export const deleteVerdict = (c: {
  versions: number;
  draft: boolean;
}): "ok" | "CONTRACT_HAS_VERSIONS" => (c.versions <= 1 || c.draft ? "ok" : "CONTRACT_HAS_VERSIONS");

export type CutoverObligation = {
  id: string;
  status: string;
  due_date: string;
  has_stock: boolean;
};

/** HD-FR-103: nghĩa vụ `open` có hạn ≥ ngày hiệu lực v(n+1) ⇒ huỷ; có dòng kho ⇒ giữ (không đảo kho) + báo; khác ⇒ không đụng. */
export function cutoverPlan(
  obs: readonly CutoverObligation[],
  effective: string,
): { cancel: string[]; keep_stock: string[] } {
  const hit = obs.filter((o) => o.status === "open" && o.due_date >= effective);
  return {
    cancel: hit.filter((o) => !o.has_stock).map((o) => o.id),
    keep_stock: hit.filter((o) => o.has_stock).map((o) => o.id),
  };
}

/** Lý do ghi trên nghĩa vụ bị huỷ (trùng chuỗi trong `contracts.k2_supersede`). */
export const cutoverReason = (versionNo: number): string => `thay bằng phiên bản ${versionNo}`;

/** Ngày hiệu lực v(n+1) = ngày bắt đầu trên văn bản; trống ⇒ hôm nay. */
export const effectiveFrom = (startDate: string | null, today: string): string =>
  startDate ?? today;

type FieldMap = Readonly<Record<string, { value?: unknown } | null | undefined>>;
export type FieldChange = { key: string; a: unknown; b: unknown };

/** UC-04: khoá (theo thứ tự `keys`) có `value` khác nhau giữa hai bản; vắng = null; so theo nội dung JSON. */
export function diffFields(a: FieldMap, b: FieldMap, keys: readonly string[]): FieldChange[] {
  const val = (m: FieldMap, k: string): unknown => m[k]?.value ?? null;
  return keys.flatMap((key) => {
    const x = val(a, key);
    const y = val(b, key);
    return JSON.stringify(x) === JSON.stringify(y) ? [] : [{ key, a: x, b: y }];
  });
}
