// Clean Architecture community (arch-a6) · kiểu thuần dùng cho luật `domain/` — domain chỉ dùng built-in ECMAScript nên KHÔNG import
// `@ai/contracts` / `application/`. Phần "cổng" (QuoteInput…CompanyBrandRow) là bản gốc, `application/pack-ports.ts` re-export lại;
// phần "View" khớp hình `@ai/contracts/community` (adapter gán sang schema contracts, typecheck bắt lệch).
export type QuoteProduct =
  | { product_id: string }
  | { new_product: { name: string; unit: string | null; group: "goods" | "service" } };

export type QuoteInput = QuoteProduct & {
  supplier: {
    party_key?: string | null | undefined;
    name: string;
    tax_id?: string | null | undefined;
  };
  price: number;
  unit: string | null;
  vat_included: boolean;
  kind: "new" | "renew";
  quoted_at: string;
  expires_on?: string | null | undefined;
  origin_ref: { pack: string } & Record<string, string | number | null>;
  url?: string | null | undefined;
};

export type QuoteCompare =
  | { kind: "first" }
  | {
      kind: "equal" | "cheaper" | "dearer";
      ref_price: number;
      ref_supplier: string;
      diff: number;
      pct: number;
    };
export type QuoteWarning =
  | { code: "deviation"; pct: number; ref_price: number }
  | { code: "vat_differs"; ref_price: number };

export type HostHintIn = { productId?: string; name?: string };
export type HostPriceOut = {
  supplierName: string;
  supplierPartyKey: string | null;
  price: number;
  unit: string | null;
  source: string;
  seenOn: string;
  vatIncluded: boolean | null;
  expiresOn: string | null;
};
export type HostProductOut = {
  index: number;
  hint: HostHintIn;
  match: {
    id: string;
    name: string;
    unit: string | null;
    how: "id" | "exact" | "prefix";
  } | null;
  onHand: string | null;
  avgCost: number | null;
  prices: HostPriceOut[];
};
export type HostBookOut = {
  products: HostProductOut[];
  partners: {
    partyKey: string;
    band: "good" | "fair" | "watch" | "new" | null;
    score: number | null;
  }[];
};

/** CR-110 · COM-FR-45: hàng nhận diện công ty chủ quản (nguồn `/company` của contracts). null = tenant chưa lưu brand. */
export type CompanyBrandRow = {
  name: string | null;
  appName: string | null;
  logo: string | null;
  accent: string;
};

export type QuoteInputView = {
  itemIdx?: number | undefined;
  commentId?: string | undefined;
  productId?: string | undefined;
  newProduct?:
    | { name: string; unit?: string | null | undefined; group?: "goods" | "service" | undefined }
    | undefined;
  price: number;
  unit?: string | null | undefined;
  vatIncluded: boolean;
  kind?: "new" | "renew" | undefined;
  quotedAt: string;
  expiresOn?: string | null | undefined;
  notify?: boolean | undefined;
};
export type QuoteCompareView =
  | { kind: "first" }
  | {
      kind: "equal" | "cheaper" | "dearer";
      refPrice: number;
      refSupplier: string;
      diff: number;
      pct: number;
    };
export type QuoteWarningView =
  | { code: "deviation"; pct: number; refPrice: number }
  | { code: "vat_differs"; refPrice: number };
export type QuotePreviewView = {
  compare: QuoteCompareView;
  warnings: QuoteWarningView[];
  replaces: number;
  existing: { by: string; at: string } | null;
};
export type HostHintView = {
  match: {
    productId: string;
    name: string;
    unit: string | null;
    how: "id" | "exact" | "prefix";
  } | null;
  onHand: string | null;
  avgCost: number | null;
  best: {
    price: number;
    unit: string | null;
    supplier: string;
    vatIncluded: boolean | null;
    seenOn: string;
  } | null;
  reputation: { band: "good" | "fair" | "watch" | "new"; score: number | null } | null;
  inStock: boolean;
};
