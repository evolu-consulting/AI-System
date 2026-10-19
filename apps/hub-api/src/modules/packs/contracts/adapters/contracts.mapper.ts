// HD-FR-07 · D-02 · D-10 · HD1 plan §1: hàng SQL (json) → DTO `@ai/contracts` (ListRow 19 khoá, Facets). Thuần: không đọc DB.
// `bigint` về JSON là số (≤ 9e15 < 2^53); `timestamptz` về ISO UTC; facet lấy tới trần + 1 ⇒ cắt ở trần và ghi `truncated`.
import type { ContractFacets, ContractListRow } from "@ai/contracts";

export type ContractListRowDto = ContractListRow;
export type ContractFacetsDto = ContractFacets;

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
