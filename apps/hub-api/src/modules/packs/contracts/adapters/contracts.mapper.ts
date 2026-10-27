// HD-FR-07 · HD-AC12 · D-02 · D-10 · D-13 · HD1 plan §1: hàng SQL (json) → DTO `@ai/contracts` (ListRow 22 khoá — CR-097 K1 `locked`, K2 `version_no` +
// `versions_count`; Facets, Detail).
// Thuần: không đọc DB. `bigint` về JSON là số (≤ 9e15 < 2^53); `timestamptz` về ISO UTC; facet lấy tới trần + 1 ⇒ cắt ở trần và
// ghi `truncated`. Chi tiết: `fields` qua `fillFields` (đủ 23 khoá, bỏ khoá lạ khi ĐỌC).
import type {
  ContractAppendixRef,
  ContractDetail,
  ContractEvent,
  ContractFacets,
  ContractFile,
  ContractItem,
  ContractListRow,
  ContractParentRef,
  ContractVersionRef,
} from "@ai/contracts";
import type { MilestoneRow } from "../application/milestones.ports";
import { fillFields } from "../domain/fields.rules";
import { currentOf } from "../domain/versions.rules";
import { type DocRaw, toContractDoc } from "./doc-types.mapper";
import { milestonesView } from "./milestones.mapper";

export type ContractListRowDto = ContractListRow;
export type ContractFacetsDto = ContractFacets;
export type ContractDetailDto = ContractDetail;

/** Một phần tử `json_agg` của câu danh sách (thừa `ord`). */
export type ListRowRaw = Omit<
  ContractListRow,
  "value" | "updated_at" | "locked" | "version_no" | "versions_count"
> & {
  /** CR-097 K1 · vắng (hàng cũ / fake) ⇒ false. */
  locked?: boolean;
  /** CR-097 K2 · vắng ⇒ 1 (HĐ một phiên bản). */
  version_no?: number;
  versions_count?: number;
  value: number | string | null;
  updated_at: string;
  ord?: number;
};

export function toContractListRow(r: ListRowRaw): ContractListRow {
  return {
    id: r.id,
    kind: r.kind,
    parent_id: r.parent_id,
    title: r.title,
    number: r.number,
    type: r.type,
    direction: r.direction,
    status: r.status,
    seller: r.seller,
    buyer: r.buyer,
    seller_signer: r.seller_signer,
    buyer_signer: r.buyer_signer,
    value: r.value === null ? null : Number(r.value),
    end_date: r.end_date,
    action_deadline: r.action_deadline,
    owner_user_id: r.owner_user_id,
    category_ids: r.category_ids ?? [],
    updated_at: new Date(r.updated_at).toISOString(),
    version: r.version,
    locked: r.locked === true,
    version_no: r.version_no ?? 1,
    versions_count: r.versions_count ?? 1,
  };
}

/** Hàng chi tiết (MỘT `json_build_object`): cột ListRow (trừ `category_ids`) + cột chi tiết + items/events/file đã gộp. */
export type DetailRaw = Omit<ListRowRaw, "category_ids" | "ord"> & {
  error: string | null;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  file_id: string | null;
  clauses: unknown[] | null;
  warnings: unknown[] | null;
  handled: ContractDetail["handled"];
  run_id: string | null;
  fields: unknown;
  items: ContractItem[] | null;
  events: (Omit<ContractEvent, "at"> & { at: string })[] | null;
  file: ContractFile | null;
  has_source: boolean;
  parent: ContractParentRef | null;
  appendices: ContractAppendixRef[] | null;
  /** V2-A */
  deal?: ContractDetail["deal"];
  commission_pct?: number | string | null;
  commission_fixed?: number | string | null;
  start_date?: string | null;
  milestones?: MilestoneRow[] | null;
  /** V2-G */
  ai_read?: ContractDetail["ai"] | null;
  /** CR-097 K1 */
  locked_at?: string | null;
  locked_by?: string | null;
  /** CR-097 K2 */
  root_id?: string;
  superseded_at?: string | null;
  superseded_by?: string | null;
  versions?:
    | (Omit<ContractVersionRef, "total_value"> & { total_value: number | string | null })[]
    | null;
  /** CR-101 DOC-model */
  doc?: DocRaw;
};

const iso = (s: string): string => new Date(s).toISOString();
const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** V2-A: loại HĐ, hoa hồng, giai đoạn + mốc (5.4a) theo ngày lịch tenant `today`. */
function v2aOf(r: DetailRaw, today: string) {
  const deal = r.deal ?? null;
  const start = r.start_date ?? null;
  const view = milestonesView(r.milestones ?? [], {
    deal,
    value: r.value,
    pct: r.commission_pct ?? null,
    fixed: r.commission_fixed ?? null,
    start,
    today,
  });
  return {
    deal,
    commission_pct: num(r.commission_pct),
    commission_fixed: num(r.commission_fixed),
    start_date: start,
    ...view,
  };
}

export function toContractDetail(r: DetailRaw, today: string): ContractDetail {
  const { category_ids: _c, ...row } = toContractListRow({ ...r, category_ids: [] });
  return {
    ...v2aOf(r, today),
    ...row,
    error: r.error,
    created_by: r.created_by,
    created_at: iso(r.created_at),
    confirmed_at: r.confirmed_at === null ? null : iso(r.confirmed_at),
    confirmed_by: r.confirmed_by,
    file_id: r.file_id,
    clauses: r.clauses ?? [],
    warnings: r.warnings ?? [],
    handled: r.handled,
    run_id: r.run_id,
    fields: fillFields(r.fields),
    items: (r.items ?? []).map((i) => ({
      ...i,
      product_id: i.product_id ?? null,
      component_ids: i.component_ids ?? null,
    })),
    events: (r.events ?? []).map((e) => ({ ...e, at: iso(e.at) })),
    file: r.file ? { ...r.file, size_bytes: Number(r.file.size_bytes) } : null,
    has_source: r.has_source,
    parent: r.parent ?? null,
    appendices: r.appendices ?? [],
    ai: r.ai_read ?? null,
    locked_at: r.locked_at ? iso(r.locked_at) : null,
    locked_by: r.locked_by ?? null,
    has_document: r.file_id !== null,
    ...chainOf(r),
    ...(r.doc
      ? { doc: toContractDoc(r.doc, { start: r.start_date ?? null, end: r.end_date }, today) }
      : {}),
  };
}

/** CR-097 K2: chuỗi phiên bản của chi tiết; bản hiện hành theo `currentOf` (bản chưa bị thay nhỏ nhất). */
function chainOf(r: DetailRaw) {
  const versions = (r.versions ?? []).map((v) => ({
    ...v,
    superseded_at: v.superseded_at ? iso(v.superseded_at) : null,
    total_value: num(v.total_value),
  }));
  const cur = currentOf(versions.map((v) => ({ ...v, locked: false })));
  return {
    root_id: r.root_id ?? r.id,
    current_id: cur?.id ?? null,
    superseded_at: r.superseded_at ? iso(r.superseded_at) : null,
    superseded_by: r.superseded_by ?? null,
    versions,
  };
}

type Counted = { v: string; n: number };
type Labelled = Counted & { label: string };
type Json<T> = T | string | null;
export type FacetsRaw = {
  status: Json<Counted[]>;
  direction: Json<Counted[]>;
  kind: Json<Counted[]>;
  owner: Json<Counted[]>;
  seller: Json<Counted[]>;
  buyer: Json<Counted[]>;
  signer: Json<Labelled[]>;
  category: Json<Labelled[]>;
  value: Json<{ min: number | string; max: number | string }>;
};

const parse = <T>(v: Json<T>): T | null =>
  typeof v === "string" ? (JSON.parse(v) as T) : (v ?? null);
const list = <T>(v: Json<T[]>): T[] => parse(v) ?? [];

export function toContractFacets(
  r: FacetsRaw,
  cap: { text: number; category: number },
): ContractFacets {
  const truncated: ContractFacets["truncated"] = [];
  const capped = <T>(name: ContractFacets["truncated"][number], xs: T[], max: number): T[] => {
    if (xs.length <= max) return xs;
    truncated.push(name);
    return xs.slice(0, max);
  };
  const value = parse(r.value);
  return {
    status: list(r.status) as ContractFacets["status"],
    direction: list(r.direction) as ContractFacets["direction"],
    kind: list(r.kind) as ContractFacets["kind"],
    owner: capped("owner", list(r.owner), cap.text),
    seller: capped("seller", list(r.seller), cap.text),
    buyer: capped("buyer", list(r.buyer), cap.text),
    signer: capped("signer", list(r.signer), cap.text),
    category: capped("category", list(r.category), cap.category),
    value: value ? { min: Number(value.min), max: Number(value.max) } : null,
    truncated,
  };
}
