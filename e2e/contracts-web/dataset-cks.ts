// HD-FR-97 · HD9-AC10 · plan-frontend N1 §6: dữ liệu giả CHUNG cho so màn S08/S10/S11 (giờ cố định 18/10/2026). Một bộ chuẩn
// (= `mgmt-app/api/tests/test_cks.py::world` + văn bản đã ký + bảng giá) và hai bộ chuyển: `cksAsMgmt` (hình
// `mgmt-app/web/src/api/{cks,cksPrices}.ts`) và `cksAsHub` (hình `@ai/contracts` cks.ts — danh sách khách có trang).
const id = (n: number) => `c4500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LOT = id(900);

type Cert = {
  id: string;
  serial: string | null;
  ca: string;
  device: "token" | "remote";
  holder_name: string;
  holder_title: string | null;
  label: string;
  valid_to: string;
  sale_price: number | null;
  signed_count: number;
  status: "active";
  keeper: string | null;
  sale_contract_id: string | null;
};
const cert = (
  o: Partial<Cert> & Pick<Cert, "id" | "label" | "holder_name" | "valid_to">,
): Cert => ({
  serial: null,
  ca: "Viettel-CA",
  device: "token",
  holder_title: null,
  sale_price: null,
  signed_count: 0,
  status: "active",
  keeper: null,
  sale_contract_id: null,
  ...o,
});
const sale = (
  n: number,
  number: string,
  signed: string,
  count: number,
  price: number,
  validTo: string,
) => ({
  contract_id: id(n),
  number,
  signed_at: signed,
  count,
  price_each: price,
  total: count * price,
  paid: false,
  valid_to: validTo,
  renewal: null as { id: string; status: "open" } | null,
});

const binhAn = {
  company_id: id(1),
  name: "Thực phẩm Sạch Bình An",
  cert_count: 1,
  group_count: 1,
  ca: "Viettel-CA",
  earliest: "2026-10-12",
  days_left: -6,
  sale_price: 1_600_000,
  signed_count: 0,
  elsewhere: false,
  has_sale: true,
  sales: [sale(101, "CKS-2025-002", "2025-10-13", 1, 1_600_000, "2026-10-12")],
  certs: [
    cert({
      id: id(11),
      label: "Chữ ký công ty",
      holder_name: "Chữ ký công ty",
      valid_to: "2026-10-12",
      sale_price: 1_600_000,
      sale_contract_id: id(101),
    }),
  ],
};
const bepViet = {
  company_id: id(2),
  name: "Bếp Việt",
  cert_count: 3,
  group_count: 1,
  ca: "Viettel-CA",
  earliest: "2026-10-27",
  days_left: 9,
  sale_price: 4_950_000,
  signed_count: 3,
  elsewhere: false,
  has_sale: true,
  sales: [sale(102, "CKS-2025-001", "2025-10-28", 3, 1_650_000, "2026-10-27")],
  certs: [
    cert({
      id: id(21),
      label: "Chữ ký công ty",
      holder_name: "Chữ ký công ty",
      serial: "5401 0B72 33AF 9E10",
      keeper: "Trần Thu Hà",
      valid_to: "2026-10-27",
      sale_price: 1_650_000,
      signed_count: 2,
      sale_contract_id: id(102),
    }),
    cert({
      id: id(22),
      label: "Giám đốc · Lê Văn Tâm",
      holder_name: "Lê Văn Tâm",
      holder_title: "Giám đốc",
      device: "remote",
      serial: "5401 0B72 33AF 9E11",
      valid_to: "2026-10-27",
      sale_price: 1_650_000,
      signed_count: 1,
      sale_contract_id: id(102),
    }),
    cert({
      id: id(23),
      label: "Kế toán trưởng · Trần Thu Hà",
      holder_name: "Trần Thu Hà",
      holder_title: "Kế toán trưởng",
      device: "remote",
      serial: "5401 0B72 33AF 9E12",
      valid_to: "2026-10-27",
      sale_price: 1_650_000,
      sale_contract_id: id(102),
    }),
  ],
};
const tanTien = {
  company_id: id(3),
  name: "Cơ khí Tân Tiến",
  cert_count: 1,
  group_count: 0,
  ca: "FPT-CA",
  earliest: "2026-11-02",
  days_left: 15,
  sale_price: null,
  signed_count: 0,
  elsewhere: true,
  has_sale: false,
  sales: [],
  certs: [
    cert({
      id: id(31),
      label: "Chữ ký công ty",
      holder_name: "Chữ ký công ty",
      ca: "FPT-CA",
      serial: "FPT-1",
      valid_to: "2026-11-02",
    }),
  ],
};
/** Bếp Việt đang gia hạn (cảnh S11 "Nhập serial mới" + hộp thoại hoàn tất). */
export const RENEWAL = id(500);
const renewingBepViet = {
  ...bepViet,
  sales: [{ ...bepViet.sales[0], renewal: { id: RENEWAL, status: "open" as const } }],
};

export const cks = {
  customers: [binhAn, bepViet, tanTien],
  bepViet,
  renewingId: id(4),
  renewing: { ...renewingBepViet, company_id: id(4), name: "Bếp Việt (đang gia hạn)" },
  overview: { certificates: 5, customers: 3, expiring_30: 4, expired: 1, in_stock: 1 },
  lots: [
    {
      id: LOT,
      label: "2026-03",
      ca: "Viettel-CA",
      qty: 5,
      sold: 4,
      customers: 2,
      in_stock: 1,
      unit_cost: 1_100_000,
      margin: 2_150_000,
      years: 1,
      device: "token" as const,
      bought_at: "2026-03-02",
      purchase_contract_id: id(901),
    },
  ],
  docs: [
    {
      id: id(61),
      certificate_id: id(21),
      kind: "tax_return" as const,
      number: null,
      title: "Tờ khai GTGT Q3/2026",
      signed_at: "2026-10-05",
      source: "xml" as const,
      contract_id: null,
    },
    {
      id: id(62),
      certificate_id: id(21),
      kind: "invoice" as const,
      number: "12",
      title: "Hóa đơn số 0000012",
      signed_at: "2026-09-02",
      source: "xml" as const,
      contract_id: null,
    },
  ],
  prices: {
    stats: { sold_12m: 3, revenue: 4_950_000, gross_profit: 1_650_000, margin_pct: 33.3 },
    market_seen: "2026-10-15",
    rows: [
      {
        label: "Viettel-CA · 1 năm",
        ca: "Viettel-CA",
        years: 1,
        device: "token" as const,
        device_label: "USB token",
        buy: 1_100_000,
        sell: 1_650_000,
        margin: 550_000,
        margin_pct: 33,
        sold: 3,
        revenue: 4_950_000,
        profit: 1_650_000,
        market: {
          min: 1_400_000,
          max: 1_500_000,
          n: 2,
          seen: "2026-10-15",
          any_device: false,
          sources: [
            {
              seller: "Đại lý B",
              tier: "gói 1",
              price: 1_400_000,
              url: null,
              kind: "renew" as const,
            },
            {
              seller: "Đại lý A",
              tier: null,
              price: 1_500_000,
              url: "https://a.vn",
              kind: "new" as const,
            },
          ],
        },
        flags: ["above_market" as const],
      },
      {
        label: "FastCA · 1 năm",
        ca: "FastCA",
        years: 1,
        device: "token" as const,
        device_label: "USB token",
        buy: 900_000,
        sell: null,
        margin: null,
        margin_pct: null,
        sold: 0,
        revenue: 0,
        profit: 0,
        market: null,
        flags: ["cheapest_buy" as const],
      },
    ],
  },
};

type Customer = typeof bepViet | typeof binhAn | typeof tanTien;
const brief = (c: Customer) => ({
  ...c,
  certs: c.certs.map((x) => ({
    id: x.id,
    label: x.label,
    device: x.device,
    ca: x.ca,
    valid_to: x.valid_to,
    sale_price: x.sale_price,
    signed_count: x.signed_count,
    sale_contract_id: x.sale_contract_id,
  })),
});

/** Hình hub: `GET /pack/contracts/cks/**` theo đường dẫn (trả `undefined` ⇒ không mock). */
export function cksAsHub(path: string, search: URLSearchParams): unknown {
  const p = path.replace(/^.*\/pack\/contracts\/cks/, "");
  if (p === "/overview") return cks.overview;
  if (p === "/customers") {
    const size = Number(search.get("page_size") ?? 50);
    return {
      items: cks.customers.map(brief),
      total: 3,
      page: 1,
      page_size: size,
      cas: ["FPT-CA", "Viettel-CA"],
    };
  }
  if (p === `/customers/${cks.renewingId}`) return cks.renewing;
  const one = cks.customers.find((c) => p === `/customers/${c.company_id}`);
  if (one) return one;
  if (p === "/lots") return cks.lots;
  if (p === "/signed-docs")
    return search.get("certificate_id") === bepViet.certs[0]?.id ? cks.docs : [];
  if (p === "/prices") return cks.prices;
  if (p === "/scans") return [];
  return undefined;
}

/** Hình mgmt-app: `/api/cks/**`, `/api/signed-docs`, `/api/prices/cks*`. */
export function cksAsMgmt(path: string, search: URLSearchParams): unknown {
  if (path === "/cks/overview") return cks.overview;
  if (path === "/cks/customers") return cks.customers;
  if (path === `/cks/customers/${cks.renewingId}`) return cks.renewing;
  const one = cks.customers.find((c) => path === `/cks/customers/${c.company_id}`);
  if (one) return one;
  if (path === "/cks/lots") return cks.lots;
  if (path === "/signed-docs")
    return search.get("certificate_id") === bepViet.certs[0]?.id ? cks.docs : [];
  if (path === "/prices/cks")
    return { stats: cks.prices.stats, rows: cks.prices.rows, market_seen: cks.prices.market_seen };
  if (path === "/prices/cks/scans") return [];
  if (path === "/prices/products") return [];
  return undefined;
}
