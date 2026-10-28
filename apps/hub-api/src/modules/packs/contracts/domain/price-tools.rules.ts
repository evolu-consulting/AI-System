// com-c10a · tra giá / so sánh / tìm NCC cho trợ lý: định dạng thuần từ `HostBookOut` (không DB, không AI). Mọi số kèm nguồn + ngày;
// rỗng ⇒ "chưa có giá"; không đoán; khác đơn vị không so; VAT không đồng nhất thì cờ cảnh báo.
import type { HostBookOut, HostPriceOut, HostProductOut } from "../application/host-book.ports";
import { foldVi } from "./fold.rules";

export const NO_PRICE = "chưa có giá";
type Band = "good" | "fair" | "watch" | "new" | null;
export type PriceRow = {
  supplier: string;
  price: number;
  unit: string | null;
  vat: "gồm VAT" | "chưa VAT" | "chưa rõ VAT";
  source: string;
  date: string;
  expires_on: string | null;
  reputation: { band: Band; score: number | null } | null;
};

const vatOf = (v: boolean | null): PriceRow["vat"] =>
  v === true ? "gồm VAT" : v === false ? "chưa VAT" : "chưa rõ VAT";

export function repMap(out: HostBookOut): Map<string, { band: Band; score: number | null }> {
  return new Map(out.partners.map((p) => [p.partyKey, { band: p.band, score: p.score }]));
}

export function partyKeysOf(out: HostBookOut): string[] {
  return [
    ...new Set(
      out.products.flatMap((p) =>
        p.prices.flatMap((x) => (x.supplierPartyKey ? [x.supplierPartyKey] : [])),
      ),
    ),
  ];
}

export function toRow(p: HostPriceOut, reps: ReturnType<typeof repMap>): PriceRow {
  return {
    supplier: p.supplierName,
    price: p.price,
    unit: p.unit,
    vat: vatOf(p.vatIncluded),
    source: p.source,
    date: p.seenOn,
    expires_on: p.expiresOn,
    reputation: p.supplierPartyKey ? (reps.get(p.supplierPartyKey) ?? null) : null,
  };
}

/** Giá mới nhất mỗi NCC (một dòng/NCC; đầu vào đã sắp mới → cũ). */
function latestPerSupplier(prices: readonly HostPriceOut[]): HostPriceOut[] {
  const seen = new Set<string>();
  return prices.filter((p) => {
    const k = p.supplierPartyKey ?? `n:${foldVi(p.supplierName)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function lookupResult(prod: HostProductOut, out: HostBookOut) {
  if (!prod.match)
    return {
      found: false,
      message: `${NO_PRICE}: không có sản phẩm khớp "${prod.hint.name ?? ""}"`,
    };
  const reps = repMap(out);
  const rows = prod.prices.map((p) => toRow(p, reps));
  return {
    found: true,
    product: prod.match.name,
    matched_by: prod.match.how,
    prices: rows,
    message: rows.length === 0 ? `${NO_PRICE} cho ${prod.match.name}` : undefined,
    note: "Giá lấy từ sổ NCC & giá của công ty; mỗi dòng ghi nguồn + ngày ghi nhận.",
  };
}

export function compareResult(
  prod: HostProductOut,
  out: HostBookOut,
  suppliers?: readonly string[],
) {
  if (!prod.match)
    return {
      found: false,
      message: `${NO_PRICE}: không có sản phẩm khớp "${prod.hint.name ?? ""}"`,
    };
  const reps = repMap(out);
  const want = (suppliers ?? []).map(foldVi).filter((s) => s !== "");
  const picked = latestPerSupplier(prod.prices).filter(
    (p) => want.length === 0 || want.some((w) => foldVi(p.supplierName).includes(w)),
  );
  if (picked.length === 0)
    return { found: true, product: prod.match.name, message: `${NO_PRICE} cho ${prod.match.name}` };
  // Đơn vị so sánh: đơn vị của SP nếu có NCC dùng, ngược lại đơn vị phổ biến nhất. Khác đơn vị không quy đổi (không đoán).
  const count = new Map<string, number>();
  for (const p of picked) count.set(p.unit ?? "", (count.get(p.unit ?? "") ?? 0) + 1);
  const unit =
    prod.match.unit !== null && count.has(prod.match.unit)
      ? prod.match.unit
      : ([...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "");
  const same = picked.filter((p) => (p.unit ?? "") === unit);
  const other = picked.filter((p) => (p.unit ?? "") !== unit);
  const rows = same.map((p) => toRow(p, reps)).sort((a, b) => a.price - b.price);
  const vats = new Set(rows.map((r) => r.vat));
  const cheapest = rows[0];
  return {
    found: true,
    product: prod.match.name,
    unit: unit || null,
    rows,
    cheapest: cheapest
      ? {
          supplier: cheapest.supplier,
          price: cheapest.price,
          vat: cheapest.vat,
          source: cheapest.source,
          date: cheapest.date,
        }
      : null,
    vat_warning:
      vats.size > 1
        ? "Các giá không cùng cơ sở VAT (gồm/chưa/chưa rõ) — chưa thể kết luận rẻ nhất chính xác."
        : undefined,
    excluded_other_unit: other.map((p) => ({
      supplier: p.supplierName,
      price: p.price,
      unit: p.unit,
      date: p.seenOn,
      source: p.source,
    })),
    note: "Mỗi NCC lấy giá mới nhất; ghi nguồn + ngày. Giá khác đơn vị không được quy đổi.",
  };
}

export function suppliersResult(prod: HostProductOut, out: HostBookOut) {
  if (!prod.match)
    return {
      found: false,
      message: `${NO_PRICE}: không có sản phẩm khớp "${prod.hint.name ?? ""}"`,
    };
  const reps = repMap(out);
  const list = latestPerSupplier(prod.prices).map((p) => ({
    supplier: p.supplierName,
    last_price: p.price,
    unit: p.unit,
    vat: vatOf(p.vatIncluded),
    source: p.source,
    date: p.seenOn,
    reputation: p.supplierPartyKey ? (reps.get(p.supplierPartyKey) ?? null) : null,
  }));
  return {
    found: true,
    product: prod.match.name,
    suppliers: list,
    message:
      list.length === 0 ? `Chưa có nhà cung cấp nào có giá cho ${prod.match.name}` : undefined,
    note: "Chỉ gồm NCC đã có giá ghi nhận trong sổ; không có dữ liệu khu vực.",
  };
}
