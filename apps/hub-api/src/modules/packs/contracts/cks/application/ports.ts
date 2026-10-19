// HD-FR-91…96 · HD9 plan §3/§4: cổng của lát CKS (lớp 2 — chỉ kiểu). Repo dựng TRONG tx của `PackUow` (RLS tenant, role
// `contracts_rw`); mọi lệnh ghi gọi `lock()` đầu tiên (D9-06). Mỗi hàm repo = MỘT câu SQL (Luật 4c, D9-21).
import type { KitTxRepos } from "../../../kit/application/index-outbox";
import type { PackUow } from "../../../kit/application/ports";
import type { CertRow } from "../domain/customers.rules";
import type { LotIn, MarketIn, SoldIn } from "../domain/prices.rules";
import type { SignedKind } from "../domain/signed.rules";

export type Device = "token" | "remote";
export type CksOverviewOut = {
  certificates: number;
  customers: number;
  expiring_30: number;
  expired: number;
  in_stock: number;
};
/** `like` = mẫu LIKE đã fold + thoát, bọc `%…%` ("%%" = không tìm). */
export type CustomerPageQuery = {
  today: string;
  filter?: "expiring" | "expired" | "elsewhere";
  lot?: string;
  ca?: string;
  like: string;
  size: number;
  offset: number;
};
export type LotOut = {
  id: string;
  label: string;
  ca: string;
  qty: number;
  sold: number;
  customers: number;
  in_stock: number;
  unit_cost: number;
  margin: number | null;
  years: number;
  device: Device;
  bought_at: string;
  purchase_contract_id: string;
};
export type RenewalOut = {
  id: string;
  sale_contract_id: string;
  company_id: string;
  certificate_ids: string[];
  status: "open" | "done" | "lost";
  new_contract_id: string;
  price_each: number;
  valid_to: string;
  lost_reason: string | null;
  done_at: string | null;
};
export type SignedDocOut = {
  id: string;
  certificate_id: string | null;
  kind: SignedKind;
  number: string | null;
  title: string;
  signed_at: string | null;
  source: "xml" | "pdf";
  contract_id: string | null;
};

/** Hợp đồng do CKS dựng (đã qua domain `lotContract`/`saleContract`). */
export type ContractWrite = {
  id: string;
  title: string;
  direction: "purchase" | "sale";
  fields: unknown;
  item: { name: string; unit: string; qty: number; unit_price: number };
};
export type AuditWrite = {
  entity: "lot" | "sale" | "renewal" | "certificate";
  entity_id: string;
  field: "unit_cost" | "price_each" | "sale_price";
  old_value: number | null;
  new_value: number | null;
};
export type CustomerWrite = { id: string; name: string; tax_id: string | null; isNew: boolean };
export type CertWrite = {
  id: string;
  serial: string | null;
  serial_key: string | null;
  ca: string;
  device: Device;
  holder_name: string;
  holder_title: string | null;
  keeper: string | null;
  valid_from: string | null;
  valid_to: string;
  source: "ours" | "elsewhere";
  lot_id: string | null;
  sale_contract_id: string | null;
  sale_price: number | null;
};

export type SaleCheck = {
  lot: { id: string; ca: string; qty: number; years: number; sold: number } | null;
  taken: string[];
  customer_id: string | null;
  numbers: string[];
};
export type RenewCheck = {
  certs: {
    id: string;
    customer_id: string;
    ca: string;
    valid_to: string;
    sale_price: number | null;
  }[];
  open: boolean;
  buyer: string | null;
  buyer_tax: string | null;
  numbers: string[];
};
export type RenewalRow = RenewalOut & { old_price: number | null };

export type CksRepo = {
  lock(): Promise<void>;
  /** Chữ ký còn hiệu lực của các khách `customerIds` (`= any` qua index). */
  liveCerts(customerIds: readonly string[]): Promise<CertRow[]>;
  overview(today: string): Promise<CksOverviewOut>;
  customerPage(q: CustomerPageQuery): Promise<{ total: number; ids: string[]; cas: string[] }>;
  lots(): Promise<LotOut[]>;
  priceInputs(): Promise<{ lots: LotIn[]; sold: SoldIn[]; market: MarketIn[] }>;
  signedDocs(q: {
    customer_id: string;
    certificate_id?: string;
    kind?: string;
  }): Promise<SignedDocOut[]>;
  customerExists(id: string): Promise<boolean>;
  saleCheck(i: {
    lotId: string | null;
    serialKeys: string[];
    tax: string | null;
    name: string;
    year: string | null;
  }): Promise<SaleCheck>;
  insertLot(w: {
    lot: {
      id: string;
      label: string;
      ca: string;
      qty: number;
      unit_cost: number;
      years: number;
      device: Device;
      bought_at: string;
    };
    contract: ContractWrite;
    audit: AuditWrite[];
  }): Promise<void>;
  insertSale(w: {
    customer: CustomerWrite;
    contract: ContractWrite | null;
    certs: CertWrite[];
    audit: AuditWrite[];
  }): Promise<void>;
  renewCheck(saleId: string, year: string): Promise<RenewCheck>;
  insertRenewal(w: {
    renewal: Omit<RenewalOut, "status" | "lost_reason" | "done_at">;
    contract: ContractWrite;
    audit: AuditWrite[];
    remindAt: { local: string; tz: string } | null;
  }): Promise<void>;
  renewal(id: string): Promise<RenewalRow | null>;
  takenSerials(keys: string[]): Promise<string[]>;
  completeRenewal(w: {
    id: string;
    today: string;
    valid_to: string;
    news: { old: string; id: string; serial: string | null; serial_key: string | null }[];
    audit: AuditWrite[];
  }): Promise<RenewalOut>;
  loseRenewal(w: { id: string; reason: string; today: string }): Promise<RenewalOut>;
  insertFollowup(w: {
    customer_id: string;
    local: string;
    tz: string;
    note: string | null;
  }): Promise<string>;
  insertSignedDocs(rows: SignedDocWrite[]): Promise<{ added: number; unmatched: number }>;
};
export type SignedDocWrite = {
  sha256: string;
  serial_key: string | null;
  kind: SignedKind;
  number: string | null;
  title: string;
  signed_at: string | null;
  period: string | null;
  source: "xml" | "pdf";
  filename: string;
  unsigned: boolean;
};

export type CksTxRepos = { cks: CksRepo } & KitTxRepos;
export type CksUow = PackUow<CksTxRepos>;
export type CksClock = {
  now(): Date;
  timeZoneOf(tenantId: string): Promise<string>;
  newId(): string;
};
