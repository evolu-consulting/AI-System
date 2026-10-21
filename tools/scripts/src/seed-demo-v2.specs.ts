// V2-O · intake C8 · dữ liệu mẫu v2 của tenant `demo`, lấy từ mockup-niti.html (CHỈ dữ liệu). Ngày viết theo lịch của mockup (VN dd/mm/yyyy,
// "hôm nay" của mockup = 19/10/2024) rồi được DỊCH theo ngày thật khi nạp ⇒ số liệu luôn "sắp đến hạn / quá hạn" như mockup.
// Thuần: không DB. Ghi chú: mốc GIAO có `items` (dòng + SL) — mốc đã làm sinh sổ kho ở build.

export type PKey =
  | "ncca"
  | "viettel"
  | "tanphat"
  | "abc"
  | "hungthinh"
  | "minhphat"
  | "anphu"
  | "binhminh"
  | "pvi"
  | "fast"
  | "lekhach";
export type Partner = {
  key: PKey;
  name: string;
  short: string;
  tax: string;
  manual?: boolean;
  /** V2-GAPS: điện thoại + người liên hệ lấy từ mockup (PINFO); Khách lẻ không có. */
  phone?: string;
  contact?: string;
};

export const OWN = { name: "Công ty Demo", tax: "0109999999" } as const;

export const PARTNERS: readonly Partner[] = [
  {
    key: "ncca",
    name: "Hãng NCCA",
    short: "Hãng NCCA",
    tax: "0101000001",
    phone: "024 3999 8888",
    contact: "Nguyễn Văn A",
  },
  {
    key: "viettel",
    name: "Viettel S-Invoice",
    short: "Viettel S-Invoice",
    tax: "0101000002",
    phone: "1800 8000",
    contact: "Phòng kinh doanh",
  },
  {
    key: "tanphat",
    name: "Cơ sở Tân Phát",
    short: "Tân Phát",
    tax: "0101000003",
    phone: "0903 111 222",
    contact: "Anh Phát",
  },
  {
    key: "abc",
    name: "Công ty TNHH ABC",
    short: "ABC",
    tax: "0101000004",
    phone: "028 3822 1111",
    contact: "Trần B",
  },
  {
    key: "hungthinh",
    name: "Công ty CP Hưng Thịnh",
    short: "Hưng Thịnh",
    tax: "0101000005",
    phone: "028 3910 2222",
    contact: "Phạm Hưng",
  },
  {
    key: "minhphat",
    name: "DNTN Minh Phát",
    short: "Minh Phát",
    tax: "0101000006",
    phone: "0912 333 444",
    contact: "Ông Minh",
  },
  {
    key: "anphu",
    name: "Công ty CP An Phú",
    short: "An Phú",
    tax: "0101000007",
    phone: "0938 555 777",
    contact: "Chị Phú",
  },
  {
    key: "binhminh",
    name: "Công ty CP Bình Minh",
    short: "Bình Minh",
    tax: "0101000008",
    phone: "0277 3811 222",
    contact: "Anh Minh",
  },
  {
    key: "pvi",
    name: "PVI / Bảo Việt",
    short: "PVI / Bảo Việt",
    tax: "0101000009",
    phone: "1900 545 458",
    contact: "Trần Bảo",
  },
  {
    key: "fast",
    name: "Hãng FAST",
    short: "Hãng FAST",
    tax: "0101000010",
    manual: true,
    phone: "024 3555 6666",
    contact: "Phòng đại lý",
  },
  {
    key: "lekhach",
    name: "Khách lẻ · Demo Shop",
    short: "Khách lẻ",
    tax: "0101000011",
    phone: "0900 000 111",
    contact: "Quầy bán lẻ",
  },
];

export type Grp = "service" | "goods" | "referral";
export type ProductSpec = {
  key: string;
  name: string;
  grp: Grp;
  unit: string;
  supplier: PKey | null;
  fromContract?: string;
  rules: readonly string[];
};
export const PRODUCTS: readonly ProductSpec[] = [
  {
    key: "cks-usb",
    name: "Chữ ký số DN – USB Token",
    grp: "service",
    unit: "chữ ký/năm",
    supplier: "ncca",
    rules: ["USB Token", "gia hạn CKS"],
  },
  {
    key: "cks-hsm",
    name: "Chữ ký số HSM",
    grp: "service",
    unit: "chữ ký/năm",
    supplier: "ncca",
    fromContract: "c1",
    rules: ["HSM"],
  },
  {
    key: "hdon",
    name: "Hoá đơn điện tử",
    grp: "service",
    unit: "gói 300 số",
    supplier: "viettel",
    rules: ["hoá đơn điện tử"],
  },
  {
    key: "hopdong-dt",
    name: "Hợp đồng điện tử",
    grp: "service",
    unit: "gói 100 HĐ",
    supplier: null,
    rules: ["hợp đồng điện tử"],
  },
  {
    key: "bangkeo",
    name: "Băng keo 5cm",
    grp: "goods",
    unit: "cuộn",
    supplier: "tanphat",
    rules: ["băng keo"],
  },
  {
    key: "thungphi",
    name: "Thùng phi 200L",
    grp: "goods",
    unit: "thùng",
    supplier: "tanphat",
    fromContract: "c3",
    rules: ["thùng phi"],
  },
  {
    key: "baohiem",
    name: "Bảo hiểm xe",
    grp: "referral",
    unit: "hợp đồng",
    supplier: "pvi",
    rules: ["bảo hiểm"],
  },
];

/** Giá NCC (SP-04/05): kind new|renew; nguồn mockup contract→manual (giá từ HĐ của mình), quote→quote, web→market. */
export type PriceSpec = {
  product: string;
  supplier: string;
  party?: PKey;
  price: number;
  kind: "new" | "renew";
  source: "manual" | "quote" | "market";
  seen: string;
  vat: boolean;
};
export const PRICES: readonly PriceSpec[] = [
  {
    product: "cks-usb",
    supplier: "Hãng NCCA",
    party: "ncca",
    price: 1250000,
    kind: "new",
    source: "manual",
    seen: "15/09/2024",
    vat: true,
  },
  {
    product: "cks-usb",
    supplier: "Hãng FAST",
    party: "fast",
    price: 1150000,
    kind: "new",
    source: "quote",
    seen: "10/08/2024",
    vat: true,
  },
  {
    product: "cks-usb",
    supplier: "Hãng BKAV",
    price: 1350000,
    kind: "new",
    source: "market",
    seen: "12/07/2024",
    vat: true,
  },
  {
    product: "cks-usb",
    supplier: "Hãng NCCA",
    party: "ncca",
    price: 980000,
    kind: "renew",
    source: "manual",
    seen: "15/09/2024",
    vat: true,
  },
  {
    product: "cks-usb",
    supplier: "Hãng EASY",
    price: 950000,
    kind: "new",
    source: "market",
    seen: "10/02/2023",
    vat: false,
  },
  {
    product: "cks-hsm",
    supplier: "Hãng NCCA",
    party: "ncca",
    price: 970000,
    kind: "new",
    source: "manual",
    seen: "15/09/2024",
    vat: true,
  },
  {
    product: "cks-hsm",
    supplier: "Hãng FAST",
    party: "fast",
    price: 1020000,
    kind: "new",
    source: "quote",
    seen: "16/09/2024",
    vat: true,
  },
  {
    product: "hdon",
    supplier: "Viettel S-Invoice",
    party: "viettel",
    price: 320000,
    kind: "new",
    source: "manual",
    seen: "01/06/2024",
    vat: true,
  },
  {
    product: "hdon",
    supplier: "MISA meInvoice",
    price: 300000,
    kind: "new",
    source: "quote",
    seen: "20/05/2024",
    vat: true,
  },
  {
    product: "hdon",
    supplier: "EasyInvoice",
    price: 275000,
    kind: "new",
    source: "market",
    seen: "15/06/2024",
    vat: true,
  },
  {
    product: "hopdong-dt",
    supplier: "FPT eContract",
    price: 1800000,
    kind: "new",
    source: "quote",
    seen: "12/08/2024",
    vat: true,
  },
  {
    product: "hopdong-dt",
    supplier: "VNPT eContract",
    price: 2000000,
    kind: "new",
    source: "market",
    seen: "18/07/2024",
    vat: true,
  },
  {
    product: "bangkeo",
    supplier: "Cơ sở Tân Phát",
    party: "tanphat",
    price: 3800,
    kind: "new",
    source: "quote",
    seen: "10/09/2024",
    vat: false,
  },
  {
    product: "bangkeo",
    supplier: "Chợ Kim Biên",
    price: 3500,
    kind: "new",
    source: "market",
    seen: "14/09/2024",
    vat: false,
  },
  {
    product: "bangkeo",
    supplier: "NPP Minh Long",
    price: 4200,
    kind: "new",
    source: "market",
    seen: "20/08/2024",
    vat: true,
  },
];

export type MsKind = "payment" | "delivery" | "commission" | "serial" | "renewal" | "other";
export type MsSpec = {
  key: string;
  kind: MsKind;
  title: string;
  due: string;
  done?: string;
  amount?: number;
  fault?: "partner" | "ours";
  /** Mốc giao: [khoá dòng, SL] */
  items?: readonly (readonly [string, number])[];
};
export type ItemSpec = {
  key: string;
  product: string;
  name: string;
  qty: number;
  price: number | null;
};
export type Deal = "buy" | "sell" | "referral";
export type ContractSpec = {
  key: string;
  deal: Deal;
  number: string;
  title: string;
  partner: PKey;
  value: number;
  who: "owner" | "editor";
  start: string;
  end: string;
  notice: number;
  status: "active" | "renewed";
  payment?: string;
  pct?: number;
  items: readonly ItemSpec[];
  ms: readonly MsSpec[];
  summary?: string;
};
