// V2-D · V2-M · ADR-0023: bản sao kiểu DTO giao hàng / kiểm tồn / xoá HĐ (`@ai/contracts`) cho lớp 1–2 — chỉ kiểu, khớp hai chiều
// kiểm ở `dto-mirror.test.ts`.
import type { ComponentMode } from "./products.types";

export type DeliveryOutcome = {
  items: { item_id: string; qty: string }[];
  stock: {
    component_id: string;
    product_id: string;
    name: string;
    mode: ComponentMode;
    on_hand_before: string;
    on_hand_after: string;
    avg_cost_before: number;
    avg_cost_after: number;
  }[];
  notes: string[];
};

export type DeliveryViewRow = {
  item_id: string;
  name: string;
  unit: string | null;
  product_id: string | null;
  on_contract: string | null;
  delivered: string;
  this_time: string;
  remaining: string | null;
};

export type DeliveryView = { milestone_id: string; status: string; rows: DeliveryViewRow[] };

export type StockCheckOut = {
  over_stock: boolean;
  components: {
    component_id: string;
    product_id: string;
    name: string;
    mode: "stock" | "quota";
    need: string;
    on_hand: string;
    over: boolean;
  }[];
};

export type StockCheckRequest = {
  items: { product_id: string; qty: number; component_ids?: string[] | null | undefined }[];
};

export type DeleteImpact = {
  contract: { id: string; number: string | null; title: string };
  milestones: number;
  delivered_lines: number;
  stock: { product: string; component: string; direction: "out" | "in"; qty: string }[];
  service_customers: number;
  products: string[];
  orphan_products: { id: string; name: string }[];
  partner_events: number;
  appendices: number;
  has_cks: boolean;
  stock_blocked: string | null;
};

export type DeleteResult = {
  deleted: true;
  audit_id: string;
  impact: {
    milestones: number;
    stock_reversed: number;
    service_customers: number;
    products: number;
    partner_events_voided: number;
    appendices: number;
  };
};
