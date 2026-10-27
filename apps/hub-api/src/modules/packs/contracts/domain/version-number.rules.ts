// CR-101a · R14 · Câu 10 (2026-10-27): số phiên bản "số gốc-SĐn" (n = version_no − 1) — CHỈ điền sẵn khi AI không đọc được số
// trên văn bản mới (sửa được, không ép). Thuần.
import type { ContractFields } from "./fields.rules";

/** Hậu tố "-SĐn" đã có ở số gốc (phòng khi bản gốc được đặt theo mẫu) — bỏ trước khi gắn n mới. */
const SUFFIX = /-SĐ\d+$/u;

/** "số gốc-SĐn"; v1 / không có số gốc ⇒ null. */
export function versionNumberOf(rootNumber: string | null, versionNo: number): string | null {
  const base = rootNumber?.trim().replace(SUFFIX, "") ?? "";
  if (!base || !Number.isInteger(versionNo) || versionNo < 2) return null;
  return `${base}-SĐ${versionNo - 1}`;
}

export type VersionChain = { versionNo: number; rootNumber: string | null };

/** Số trên bản mới trống (AI không đọc được, người chưa sửa) ⇒ điền sẵn "số gốc-SĐn", chưa xác minh (người kiểm sửa được). */
export function prefillVersionNumber(
  fields: ContractFields,
  chain: VersionChain | null,
): ContractFields {
  const cur = fields.number;
  const blank = cur.value === null || (typeof cur.value === "string" && cur.value.trim() === "");
  if (!chain || !blank || cur.edited) return fields;
  const value = versionNumberOf(chain.rootNumber, chain.versionNo);
  if (value === null) return fields;
  return { ...fields, number: { value, quote: "", verified: false, edited: false } };
}
