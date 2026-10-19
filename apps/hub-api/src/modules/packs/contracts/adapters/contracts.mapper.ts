// HD-FR-07 · HD-AC12 · D-02 · D-10 · D-13 · HD1 plan §1: hàng SQL (json) → DTO `@ai/contracts` (ListRow 19 khoá, Facets, Detail).
// Thuần: không đọc DB. `bigint` về JSON là số (≤ 9e15 < 2^53); `timestamptz` về ISO UTC; facet lấy tới trần + 1 ⇒ cắt ở trần và
// ghi `truncated`. Chi tiết: `fields` qua `fillFields` (đủ 23 khoá, bỏ khoá lạ khi ĐỌC).
import type {
  ContractDetail,
  ContractEvent,
  ContractFacets,
  ContractFile,
  ContractItem,
  ContractListRow,
} from "@ai/contracts";
import { fillFields } from "../domain/fields.rules";

export type ContractListRowDto = ContractListRow;
export type ContractFacetsDto = ContractFacets;
export type ContractDetailDto = ContractDetail;

/** Một phần tử `json_agg` của câu danh sách (thừa `ord`). */
export type ListRowRaw = Omit<ContractListRow, "value" | "updated_at"> & {
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
};

const iso = (s: string): string => new Date(s).toISOString();

export function toContractDetail(r: DetailRaw): ContractDetail {
  const { category_ids: _c, ...row } = toContractListRow({ ...r, category_ids: [] });
  return {
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
    items: r.items ?? [],
    events: (r.events ?? []).map((e) => ({ ...e, at: iso(e.at) })),
    file: r.file ? { ...r.file, size_bytes: Number(r.file.size_bytes) } : null,
    has_source: r.has_source,
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
