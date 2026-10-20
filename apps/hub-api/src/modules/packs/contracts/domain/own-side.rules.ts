// V2-L · V2-G: công ty mình đứng bên nào của hợp đồng (Mua hay Bán) — so tên pháp nhân / MST của mình (`company_settings`) với bên cung cấp
// và bên mua mà AI đọc được. Đúng MỘT bên khớp ⇒ biết chắc (mình là bên cung cấp ⇒ Bán; bên mua ⇒ Mua); cả hai/không bên nào ⇒ chưa biết.
// Thuần, không I/O.
export type OwnParties = { names: readonly string[]; taxIds: readonly string[] };
export const NO_OWN: OwnParties = { names: [], taxIds: [] };

export type PartySide = { name: unknown; tax: unknown };
const text = (v: unknown): string => (typeof v === "string" ? v : "");
/** Không dấu, chữ thường, chỉ chữ/số cách nhau một dấu cách. */
export const foldName = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** MST 10 số (bỏ mã chi nhánh -xxx). */
const taxCore = (s: string): string => s.replace(/\D/g, "").slice(0, 10);

function isOwn(p: PartySide, own: OwnParties): boolean {
  const tax = taxCore(text(p.tax));
  if (tax.length === 10 && own.taxIds.some((t) => taxCore(t) === tax)) return true;
  const name = foldName(text(p.name));
  return name !== "" && own.names.some((n) => foldName(n) === name);
}

/** "sell" = mình là bên cung cấp; "buy" = mình là bên mua; null = không phân định được. */
export function ownDeal(
  f: { supplier: PartySide; buyer: PartySide },
  own: OwnParties,
): "buy" | "sell" | null {
  if (!own.names.length && !own.taxIds.length) return null;
  const s = isOwn(f.supplier, own);
  const b = isOwn(f.buyer, own);
  return s === b ? null : s ? "sell" : "buy";
}
