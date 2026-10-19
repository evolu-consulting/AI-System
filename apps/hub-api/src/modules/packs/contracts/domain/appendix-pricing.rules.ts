// HD-FR-55 · D-HD5-01 · port `contracts/project.py:_parent_products` + `_link_addendum`: giá phụ lục thay giá HĐ gốc từ ngày hiệu lực.
// Thuần, không đọc DB. Dòng của phụ lục cùng sản phẩm với dòng cũ ⇒ dòng cũ hết hạn NGÀY TRƯỚC `effective_date`, dòng mới có
// hiệu lực từ ngày đó. Không ghi `valid_to`/`total_value` (tính khi đọc); `valid_from/valid_to` do người nhập giữ nguyên khi
// không bị phụ lục thay.
import { foldVi } from "./fold.rules";

export type PriceItem = {
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
  vat_rate: number | null;
  valid_from: string | null;
  valid_to: string | null;
};
export type PriceSource = {
  id: string;
  kind: "contract" | "appendix";
  title: string;
  /** Ngày hiệu lực của phụ lục (`fields.effective_date`); HĐ gốc / phụ lục thiếu ngày ⇒ `null` (không thay giá ai). */
  effective_date: string | null;
  items: readonly PriceItem[];
};
export type PricedLine = {
  item: Pick<PriceItem, "code" | "name" | "spec" | "unit" | "qty" | "unit_price" | "vat_rate">;
  source: { id: string; kind: "contract" | "appendix"; title: string };
  valid_from: string | null;
  valid_to: string | null;
  superseded_by: string | null;
  current: boolean;
};

// Tên hàng lặp lại rất nhiều giữa các HĐ (báo cáo "Mua hàng" gấp hàng nghìn dòng) và `foldVi` đi từng ký tự ⇒ nhớ kết quả (thuần).
const foldMemo = new Map<string, string>();
const fold = (s: string | null | undefined): string => {
  const k = s ?? "";
  let v = foldMemo.get(k);
  if (v === undefined) {
    if (foldMemo.size > 50_000) foldMemo.clear();
    v = foldVi(k);
    foldMemo.set(k, v);
  }
  return v;
};

/** Khoá sản phẩm: có mã ⇒ theo mã; không ⇒ tên + quy cách (đã fold). */
export function productKey(i: Pick<PriceItem, "code" | "name" | "spec">): string {
  return i.code?.trim() ? `code:${fold(i.code)}` : `name:${fold(i.name)}|${fold(i.spec)}`;
}

/** `_parent_products`: dòng phụ lục không mã, tên trùng đúng MỘT sản phẩm của HĐ gốc ⇒ là sản phẩm đó (phụ lục gọi tên ngắn). */
export function resolver(parent: readonly PriceItem[]): (i: PriceItem) => string {
  const byName = new Map<string, Set<string>>();
  for (const p of parent) {
    const n = fold(p.name);
    byName.set(n, (byName.get(n) ?? new Set()).add(productKey(p)));
  }
  return (i) => {
    if (i.code?.trim()) return productKey(i);
    const keys = byName.get(fold(i.name));
    return (keys?.size === 1 ? [...keys][0] : undefined) ?? productKey(i);
  };
}

/** `YYYY-MM-DD` trừ một ngày (UTC, không dính múi giờ máy). */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Phụ lục thiếu ngày hiệu lực xếp cuối (sau mọi ngày ISO). */
const NO_DATE = "￿";

type Work = PricedLine & { key: string; rank: number };

/** Dòng cũ cùng sản phẩm hết hạn ngày trước `eff`; dòng mới có hiệu lực từ `eff` (nếu chưa có ngày). */
function supersede(old: Work[], added: Work[], by: string, eff: string): void {
  const before = dayBefore(eff);
  const keys = new Set(added.map((l) => l.key));
  for (const o of old.filter((l) => keys.has(l.key))) {
    o.superseded_by = by;
    if (o.valid_to === null || o.valid_to > before) o.valid_to = before;
  }
  for (const l of added) l.valid_from ??= eff;
}

/**
 * `parent` = HĐ gốc; `appendices` theo thứ tự tạo (ổn định khi trùng ngày). Phụ lục có `effective_date` được xử lý theo ngày tăng dần;
 * phụ lục thiếu ngày giữ dòng của nó nguyên (không thay gì). Kết quả: dòng HĐ gốc trước, rồi phụ lục theo ngày.
 */
export function applyAppendixPricing(
  parent: PriceSource,
  appendices: readonly PriceSource[],
  asOf: string,
): PricedLine[] {
  return applyAppendixPricingKeyed(parent, appendices, asOf).map(({ key: _k, ...l }) => l);
}

/** HD8: như `applyAppendixPricing` nhưng giữ khoá sản phẩm đã quy về sản phẩm của HĐ gốc (so giá theo sản phẩm). */
export function applyAppendixPricingKeyed(
  parent: PriceSource,
  appendices: readonly PriceSource[],
  asOf: string,
): (PricedLine & { key: string })[] {
  const keyOf = resolver(parent.items);
  const make = (s: PriceSource, i: PriceItem, rank: number): Work => ({
    item: {
      code: i.code,
      name: i.name,
      spec: i.spec,
      unit: i.unit,
      qty: i.qty,
      unit_price: i.unit_price,
      vat_rate: i.vat_rate,
    },
    source: { id: s.id, kind: s.kind, title: s.title },
    valid_from: i.valid_from,
    valid_to: i.valid_to,
    superseded_by: null,
    current: false,
    key: keyOf(i),
    rank,
  });
  const lines: Work[] = parent.items.map((i) => make(parent, i, 0));
  const dated = appendices
    .map((a, n) => ({ a, n }))
    .sort(
      (x, y) =>
        (x.a.effective_date ?? NO_DATE).localeCompare(y.a.effective_date ?? NO_DATE) || x.n - y.n,
    );
  for (const { a } of dated) {
    const added = a.items.map((i) => make(a, i, 1));
    if (a.effective_date) supersede(lines, added, a.id, a.effective_date);
    lines.push(...added);
  }
  return lines.map(({ rank: _r, ...l }) => ({
    ...l,
    current:
      (l.valid_from === null || l.valid_from <= asOf) &&
      (l.valid_to === null || l.valid_to >= asOf),
  }));
}
