// CR-102b · ADR-0031 · hai cổng community KHAI (kiểu thuần, KHÔNG import gói contracts): `SupplierQuoteWriter` (ghi duy nhất vào SP & Giá)
// và `HostBookReader` (đọc sổ chủ quản). Cùng hình với bản contracts cung cấp; `packs/community-wire.mount.ts` tiêm usecase thật,
// typecheck ở đó bắt lệch hợp đồng.
export type QuoteCaller = { tenantId: string; userId: string; kind: "internal" | "external" };

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
export type QuotePreview = { compare: QuoteCompare; warnings: QuoteWarning[]; replaces: string[] };
export type QuoteSaved = QuotePreview & {
  price_id: string;
  product_id: string;
  product_created: boolean;
  supplier_party_key: string;
  supplier_created: boolean;
};

export type SupplierQuoteWriter = {
  preview(by: QuoteCaller, q: QuoteInput): Promise<QuotePreview>;
  save(by: QuoteCaller, q: QuoteInput): Promise<QuoteSaved>;
};

/** Lỗi cổng ghi (cùng `kind` với `SaveQuoteFail` của contracts; so khớp theo `kind`, không `instanceof`). */
export const QUOTE_FAIL_KINDS = ["forbidden", "not_found", "invalid", "exists"] as const;

export type HostHintIn = { productId?: string; name?: string };
export type HostCaller = {
  tenantId: string;
  userId: string;
  userKind?: "internal" | "external";
  extOrgId?: string | null;
  kind?: "internal" | "external";
};
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
export type HostBookReader = {
  read(
    who: HostCaller,
    q: { hints: readonly HostHintIn[]; partyKeys?: readonly string[] },
  ): Promise<HostBookOut>;
  /**
   * C8 → C9 (`matchBuy`): user nội bộ có quyền đọc gói contracts khi tenant đang có hàng (tồn > 0) khớp tên `product`. MỘT tx sổ,
   * số câu cố định + MỘT câu quyền theo tập — không vòng theo người.
   */
  stockHolders(tenantId: string, product: string): Promise<readonly string[]>;
};
