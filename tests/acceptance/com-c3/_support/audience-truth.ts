// CR-191 · BẢNG CHÂN TRỊ «Ai thấy bài» — dữ liệu thuần, dùng chung cho: unit hub (`audience.rules.test.ts`), unit web (`audience.test.ts`),
// int SQL (`audience-schema.int.test.ts`: `community.audience_ok` khớp mọi dòng `partner`). Một nguồn ⇒ ba bản luật không lệch (G1).
// Người xem: `internal` = nhân viên tenant đăng bài, KHÔNG phải người đăng/người được giao (luật không phụ thuộc người tạo);
// `partner` = đối tác trong cộng đồng (ext_org); `connected` = người công ty ĐÃ KẾT NỐI (tenant khác).
type Lab = "supplier" | "customer";
export type TruthViewer =
  | { kind: "internal" }
  | { kind: "partner"; org: string; labels: Lab[]; cats: string[] }
  | { kind: "connected"; tenantId: string; labels: Lab[] };
export type TruthAud = {
  mode: "all" | "internal" | "suppliers" | "buyers" | "cats" | "companies";
  cats: string[];
  companies: string[];
  tenants: string[];
};
export type TruthRow = {
  name: string;
  aud: TruthAud;
  type: "sell" | "buy" | "note";
  postCats: string[];
  viewer: TruthViewer;
  want: boolean;
};

const T1 = "00000000-0000-4000-8000-0000000000a1"; // tenant công ty kết nối được chọn đích danh
const T2 = "00000000-0000-4000-8000-0000000000a2"; // công ty kết nối khác (không được chọn)
const ORG_S1 = "00000000-0000-4000-8000-0000000000b1"; // ext_org trùng `companies`
const ORG_B1 = "00000000-0000-4000-8000-0000000000b2";
export const IDS = { T1, T2, ORG_S1, ORG_B1 };

const VIEWERS = {
  internal: { kind: "internal" } as TruthViewer,
  pSup: { kind: "partner", org: ORG_S1, labels: ["supplier"], cats: ["dong-goi"] } as TruthViewer,
  pBuy: { kind: "partner", org: ORG_B1, labels: ["customer"], cats: ["dong-goi"] } as TruthViewer,
  pBoth: {
    kind: "partner",
    org: "x",
    labels: ["supplier", "customer"],
    cats: ["dong-goi"],
  } as TruthViewer,
  pNone: { kind: "partner", org: "n", labels: [], cats: [] } as TruthViewer,
  cSup1: { kind: "connected", tenantId: T1, labels: ["supplier"] } as TruthViewer,
  cBuy2: { kind: "connected", tenantId: T2, labels: ["customer"] } as TruthViewer,
  cBoth2: { kind: "connected", tenantId: T2, labels: ["supplier", "customer"] } as TruthViewer,
  cNone1: { kind: "connected", tenantId: T1, labels: [] } as TruthViewer,
  cNone2: { kind: "connected", tenantId: T2, labels: [] } as TruthViewer,
};
type VK = keyof typeof VIEWERS;

const aud = (mode: TruthAud["mode"], more: Partial<TruthAud> = {}): TruthAud => ({
  mode,
  cats: [],
  companies: [],
  tenants: [],
  ...more,
});
// [tên mức, aud, loại bài, {người xem: thấy?}] — người xem không liệt kê = false.
const SPEC: [string, TruthAud, "sell" | "buy" | "note", VK[]][] = [
  [
    "all",
    aud("all"),
    "note",
    ["internal", "pSup", "pBuy", "pBoth", "pNone", "cSup1", "cBuy2", "cBoth2", "cNone1", "cNone2"],
  ],
  ["internal (Chỉ nội bộ)", aud("internal"), "note", ["internal"]],
  ["suppliers", aud("suppliers"), "note", ["internal", "pSup", "pBoth", "cSup1", "cBoth2"]],
  ["buyers", aud("buyers"), "note", ["internal", "pBuy", "pBoth", "cBuy2", "cBoth2"]],
  // cats (bài cũ): người nội bộ thấy; đối tác theo nhóm hàng + nhãn; công ty kết nối KHÔNG thấy
  ["cats bán đóng gói", aud("cats"), "sell", ["internal", "pBuy", "pBoth"]],
  ["cats mua đóng gói", aud("cats"), "buy", ["internal", "pSup", "pBoth"]],
  ["cats thông báo đóng gói", aud("cats"), "note", ["internal", "pSup", "pBuy", "pBoth"]],
  // companies: ext_org ở `companies` chỉ áp đối tác; tenant ở `tenants` chỉ áp công ty kết nối (hai tập id khác nhau, không chéo)
  [
    "companies ext_org {S1}",
    aud("companies", { companies: [ORG_S1] }),
    "note",
    ["internal", "pSup"],
  ],
  [
    "companies tenant {T1}",
    aud("companies", { tenants: [T1] }),
    "note",
    ["internal", "cSup1", "cNone1"],
  ],
  [
    "companies cả hai tập",
    aud("companies", { companies: [ORG_B1], tenants: [T2] }),
    "note",
    ["internal", "pBuy", "cBuy2", "cBoth2", "cNone2"],
  ],
  ["companies rỗng", aud("companies"), "note", ["internal"]],
];

export const TRUTH: TruthRow[] = SPEC.flatMap(([name, a, type, seen]) =>
  (Object.keys(VIEWERS) as VK[]).map((k) => ({
    name: `${name} × ${k}`,
    aud: a,
    type,
    postCats: ["dong-goi"],
    viewer: VIEWERS[k],
    want: seen.includes(k),
  })),
);
