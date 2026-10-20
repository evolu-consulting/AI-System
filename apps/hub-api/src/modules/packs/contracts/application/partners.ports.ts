// HD8-FR-01…06 · ADR-0023: cổng repo đối tác / điểm uy tín / báo giá (lớp 2 — chỉ kiểu); `adapters/partners.repo.ts` +
// `adapters/partners-data.repo.ts` cài. Hai phần đọc song song `ledger`/`facts` là hình thô của SQL (adapter) ⇒ cổng generic
// `L`/`F`, chỉ `combine` (adapter `partnerDataOf`) hiểu; use case chỉ chuyển tiếp.
import type { PricedContract, Quote } from "../domain/goods-prices.rules";
import type { FactRow, PartyEv } from "../domain/partners.rules";
import type { QuoteCreate } from "../domain/reputation.types";
import type { Agg } from "../domain/scoring-agg.rules";
import type { Criterion, Role, Rules } from "../domain/scoring-config.rules";

export type StoredConfig = {
  role: Role;
  version: number;
  criteria: Criterion[];
  rules: Rules;
  updated_by: string | null;
  updated_at: string | null;
};
export type Market = { min: number; max: number; seen: string; n: number };
export type PartnerData = {
  facts: FactRow[];
  /** HĐ mua đã duyệt (mọi loại) + dòng hàng — đủ cho giá phía NCC (chênh giá, so giá). */
  contracts: PricedContract[];
  /** Sổ đối tác đã gom, khoá `aggKey(đối tác, vai)`. */
  aggs: Map<string, Agg>;
  configs: StoredConfig[];
  quotes: Quote[];
  /** Danh bạ: khoá đối tác ⇒ tên ngắn ?? tên (HD8-FR-09). */
  names: Map<string, string>;
  /** Giá thị trường hàng hoá theo mặt hàng (HD8-FR-08). */
  market: Map<string, Market>;
};
/** Khoảng tính đè theo vai (bản nháp xem trước/lưu). */
export type WindowOverride = Partial<
  Record<Role, { window_months: number; recency_months: number }>
>;
export type PricesPart = { contracts: PricedContract[]; quotes: Quote[] };
/** Ba phần đọc song song (sổ, sự thật HĐ, giá) ⇒ `combine` ghép. */
export type PartnerParts<L, F> = [L, F, PricesPart];

export type RatingWrite = {
  party: string;
  role: Role;
  at: string;
  criterion: string;
  value: number;
  note: string | null;
};
export type QuoteWrite = QuoteCreate & {
  product_name: string;
  unit: string | null;
  tax: string | null;
  check: { verified: boolean | null; page_date: string | null; note: string | null };
};
export type ConfigWrite = {
  role: Role;
  version: number;
  by: string;
  criteria: readonly Criterion[];
  rules: Rules;
  summary: string;
  before: unknown;
  snapshots: { party: string; score: number | null; band: string | null }[];
};
export type ConfigSaved = { version: number; updated_at: string; updated_by: string | null };
export type ConfigHistoryRow = { version: number; at: string; by: string | null; summary: string };

export type PartnersRepo<L, F> = {
  insertRating(w: RatingWrite): Promise<PartyEv | null>;
  insertQuote(q: QuoteWrite): Promise<{ id: string }>;
  deleteQuote(id: string): Promise<boolean>;
  saveConfig(w: ConfigWrite): Promise<ConfigSaved>;
  history(role: Role): Promise<ConfigHistoryRow[]>;
  ledger(today: string, ov?: WindowOverride, roles?: readonly Role[]): Promise<L>;
  facts(today: string): Promise<F>;
  prices(): Promise<PricesPart>;
  ratingEvents(party: string, role: Role): Promise<PartyEv[]>;
  config(role: Role): Promise<StoredConfig | null>;
  lockConfig(role: Role): Promise<StoredConfig | null>;
};
