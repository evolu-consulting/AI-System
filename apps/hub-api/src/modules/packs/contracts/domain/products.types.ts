// V2-B · ADR-0023: bản sao kiểu DTO sản phẩm (`@ai/contracts` pack-contracts/products) cho lớp 1–2 — chỉ kiểu, khớp hai chiều
// kiểm ở `dto-mirror.test.ts`.

export type ProductGroup = "referral" | "service" | "goods";
export type ComponentMode = "stock" | "quota" | "order" | "none";
export type ProductDeal = "referral" | "buy" | "sell";

export type ProductCreate = {
  name: string;
  group: ProductGroup;
  unit?: string | null | undefined;
  spec?: string | null | undefined;
  no_stock?: boolean | undefined;
  components?:
    | { name: string; unit?: string | null | undefined; mode?: ComponentMode | undefined }[]
    | undefined;
  rules?: { pattern: string; component?: number | null | undefined }[] | undefined;
  main_supplier?: { name: string; tax_id?: string | null | undefined } | null | undefined;
  from_contract_id?: string | null | undefined;
};

/** gap-d1 #18 · nhập lô tay (khớp `ProductLotCreateSchema`). */
export type ProductLotCreate = {
  component_id?: string | null | undefined;
  qty: string;
  unit_price: number;
  received_on?: string | null | undefined;
  expires_on?: string | null | undefined;
  supplier?: { name: string; tax_id?: string | null | undefined } | null | undefined;
};
export type ProductLotResultOut = {
  component_id: string;
  on_hand_before: string;
  on_hand_after: string;
  avg_cost_before: number;
  avg_cost_after: number;
};

export type ProductComponentOut = {
  id: string;
  ord: number;
  name: string;
  unit: string | null;
  mode: ComponentMode;
  on_hand: string;
  avg_cost: number;
  stock_value: number;
};

export type ProductRuleOut = { id: string; pattern: string; component_id: string | null };

export type ProductOut = {
  id: string;
  name: string;
  unit: string | null;
  spec: string | null;
  group: ProductGroup;
  main_supplier: { party_key: string; name: string | null } | null;
  created_from_contract_id: string | null;
  components: ProductComponentOut[];
  rules: ProductRuleOut[];
};

export type ProductLotOut = {
  id: string;
  component_id: string;
  qty: string;
  remaining: string;
  received_on: string;
  expires_on: string | null;
};

export type StockMoveOut = {
  id: string;
  component_id: string;
  direction: "in" | "out";
  reason: "delivery" | "expire" | "reversal" | "manual";
  qty: string;
  unit_cost: number;
  amount: number;
  on_hand_after: string | null;
  avg_after: number | null;
  moved_on: string;
  contract_id: string | null;
};

export type ProductDetailOut = ProductOut & { lots: ProductLotOut[]; moves: StockMoveOut[] };

export type ProductMatchOut = {
  suggestions: {
    product: ProductOut;
    component_id: string | null;
    by: "rule" | "words";
    score: number;
  }[];
  create: { name: string } | null;
};

export type ProductMatch = { text: string; deal?: ProductDeal | null | undefined };
export type ProductRuleCreate = { pattern: string; component_id?: string | null | undefined };
export type ProductsQuery = {
  group?: ProductGroup | undefined;
  q?: string | undefined;
  limit?: number | undefined;
};
