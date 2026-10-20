// HD-FR-96 · BR-1 · D9-11 · D9-15: giá CKS mua–bán theo gói (CA · năm · thiết bị) — port nguyên `mgmt-app/api/app/prices/cks.py`.
// Tiền số nguyên đồng; phần trăm làm tròn half-even bằng BigInt (như `round` Python, không float khi chia tiền). Lớp 1 — thuần.
export type PkgDevice = "token" | "remote";
export type PkgFilter = "all" | "1y" | "multi" | "token" | "remote";
export type LotIn = {
  id: string;
  ca: string;
  years: number;
  device: PkgDevice;
  unit_cost: number;
  bought_at: string;
};
/** Chữ ký đã xuất từ lô (không phải chữ ký gia hạn), sắp theo (`valid_to`, `id`). */
export type SoldIn = { lot_id: string; valid_from: string | null; sale_price: number | null };
export type MarketIn = {
  ca_key: string;
  years: number;
  device: PkgDevice | null;
  kind: "new" | "renew" | null;
  seller: string;
  tier: string | null;
  price_ex_vat: number | null;
  url: string | null;
  verified: boolean;
  seen: string;
};

const CA_NAMES = [
  "viettel",
  "easyca",
  "fastca",
  "ica",
  "ncca",
  "ca2",
  "smartsign",
  "newtel",
  "oneca",
  "vnpt",
  "fpt",
  "misa",
].sort((a, b) => b.length - a.length);
export const DEVICE_VI: Record<PkgDevice, string> = { token: "USB token", remote: "Ký từ xa" };

/** "Viettel-CA" ⇒ "viettel"; "MISA eSign (MISA-CA)" ⇒ "misa"; "Mắt Bão CA" ⇒ "matbao" (`cks.py:23-31`). */
export function caKey(name: string): string {
  const head = (name ?? "").split("(")[0] ?? "";
  const plain = head.replaceAll("đ", "d").replaceAll("Đ", "D").normalize("NFKD");
  // Như encode("ascii","ignore").lower() rồi bỏ ký tự ngoài [a-z0-9]: bỏ non-ASCII TRƯỚC khi hạ chữ.
  const s = plain.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  for (const k of CA_NAMES) if (s.startsWith(k)) return k;
  return s.replace(/ca$/, "") || s;
}

/** `round(x, nd)` của Python trên số float (review M1): làm tròn half-even theo GIÁ TRỊ NHỊ PHÂN THẬT của `x` — vd
 *  `100*247000/2000000` = 12,3499999… ⇒ 12,3 (không phải 12,4). `toFixed(60)` cho đủ chữ số thập phân chính xác của một
 *  double cỡ phần trăm (≤ 52 chữ số lẻ). Chỉ dùng cho tỉ lệ hiển thị; số tiền vẫn là số nguyên đồng. */
export function pyRound(x: number, nd = 0): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const exact = Math.abs(x).toFixed(60);
  const dot = exact.indexOf(".");
  const keep = exact.slice(0, dot + 1 + nd).replace(/\.$/, "");
  const rest = exact.slice(dot + 1 + nd);
  const digits = keep.replace(".", "");
  const last = Number(digits.at(-1));
  const first = rest[0] ?? "0";
  const tie = /^50*$/.test(rest);
  const up = first > "5" || (first === "5" && (!tie || last % 2 === 1));
  let n = BigInt(digits) + (up ? 1n : 0n);
  if (neg) n = -n;
  return Number(n) / 10 ** nd;
}

function marketRange(obs: readonly MarketIn[], ca: string, years: number, device: PkgDevice) {
  const same = obs.filter(
    (o) => o.ca_key === ca && o.years === years && o.verified && o.price_ex_vat,
  );
  const exact = same.filter((o) => o.device === device || !o.device);
  const anyDevice = exact.length === 0 && same.length > 0;
  const hits = exact.length ? exact : same;
  if (!hits.length) return null;
  const prices = hits.map((o) => o.price_ex_vat as number);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    n: hits.length,
    seen: hits.reduce((m, o) => (o.seen > m ? o.seen : m), ""),
    any_device: anyDevice,
    sources: [...hits]
      .sort((a, b) => (a.price_ex_vat as number) - (b.price_ex_vat as number))
      .slice(0, 6)
      .map((o) => ({
        seller: o.seller,
        tier: o.tier,
        price: o.price_ex_vat as number,
        url: o.url,
        kind: o.kind,
      })),
  };
}

type Pkg = {
  ca: string;
  years: number;
  device: PkgDevice;
  buy: number;
  sell: number | null;
  sold: number;
  revenue: number;
  profit: number;
};

const FILTERS: Record<PkgFilter, (p: { years: number; device: PkgDevice }) => boolean> = {
  all: () => true,
  "1y": (p) => p.years === 1,
  multi: (p) => p.years > 1,
  token: (p) => p.device === "token",
  remote: (p) => p.device === "remote",
};

function collect(lots: readonly LotIn[], sold: readonly SoldIn[], today: string): Map<string, Pkg> {
  const keyOf = (l: LotIn) => `${caKey(l.ca)}|${l.years}|${l.device}`;
  const pk = new Map<string, Pkg>();
  for (const l of [...lots].sort((a, b) =>
    a.bought_at < b.bought_at ? -1 : a.bought_at > b.bought_at ? 1 : 0,
  ))
    pk.set(keyOf(l), {
      ca: l.ca,
      years: l.years,
      device: l.device,
      buy: l.unit_cost,
      sell: null,
      sold: 0,
      revenue: 0,
      profit: 0,
    });
  const byLot = new Map(lots.map((l) => [l.id, l]));
  const since = addDaysIso(today, -365);
  const last = new Map<string, string>();
  for (const c of sold) {
    const lot = byLot.get(c.lot_id);
    if (!lot || c.sale_price === null || (c.valid_from ?? "") < since) continue;
    const key = keyOf(lot);
    const p = pk.get(key) as Pkg;
    p.sold += 1;
    p.revenue += c.sale_price;
    p.profit += c.sale_price - lot.unit_cost;
    if ((c.valid_from ?? "") >= (last.get(key) ?? "")) {
      last.set(key, c.valid_from ?? "");
      p.sell = c.sale_price;
    }
  }
  return pk;
}

const addDaysIso = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Bảng "Chữ ký số của tôi" + thống kê 12 tháng (`cks.py:53-95`). */
export function cksPackages(
  i: { lots: readonly LotIn[]; sold: readonly SoldIn[]; market: readonly MarketIn[] },
  today: string,
  filter: PkgFilter = "all",
) {
  const { lots, sold, market } = i;
  const rows = [...collect(lots, sold, today).entries()].map(([key, p]) => {
    const margin = p.sell === null ? null : p.sell - p.buy;
    return {
      ...p,
      label: `${p.ca} · ${p.years} năm`,
      device_label: DEVICE_VI[p.device],
      margin,
      margin_pct: margin !== null && p.sell ? pyRound((100 * margin) / p.sell) : null,
      market: marketRange(market, key.split("|")[0] as string, p.years, p.device),
      flags: [] as ("cheapest_buy" | "above_market")[],
    };
  });
  for (const years of new Set(rows.map((r) => r.years))) {
    const same = rows.filter((r) => r.years === years);
    if (same.length > 1) same.reduce((m, r) => (r.buy < m.buy ? r : m)).flags.push("cheapest_buy");
  }
  for (const r of rows)
    if (r.market && r.sell !== null && r.sell > r.market.max) r.flags.push("above_market");
  const shown = rows
    .filter((r) => FILTERS[filter](r))
    .sort((a, b) => b.sold - a.sold || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const revenue = shown.reduce((s, r) => s + r.revenue, 0);
  const profit = shown.reduce((s, r) => s + r.profit, 0);
  return {
    stats: {
      sold_12m: shown.reduce((s, r) => s + r.sold, 0),
      revenue,
      gross_profit: profit,
      margin_pct: revenue ? pyRound((100 * profit) / revenue, 1) : null,
    },
    rows: shown,
    market_seen: market.reduce<string | null>(
      (m, o) => (m === null || o.seen > m ? o.seen : m),
      null,
    ),
  };
}
