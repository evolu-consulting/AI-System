// HD-FR-51 · S03: dữ liệu danh sách phía server — truy vấn theo q/lọc/trang (có debounce chữ tìm), lựa chọn lọc từ facets,
// tên phụ trách từ danh bạ, tên loại hàng. Giữ trang cũ khi đổi bộ lọc (không nhấp nháy).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnFilter, useTable } from "~/features/table";
import {
  CATEGORIES_KEY,
  FACETS_KEY,
  fetchCategories,
  fetchFacets,
  fetchList,
  fetchMembers,
  listKey,
  MEMBERS_KEY,
} from "../api";
import { type FilterMaps, filterMaps, listQueryString, optionLabels } from "../lib/list-model";

const DEBOUNCE_MS = 250;
/** Danh bạ/facets/loại hàng ít đổi: dùng lại trong phiên. */
const STALE_MS = 60_000;

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

type Row = unknown;
const FILTERS: { key: keyof FilterMaps | "value"; kind?: "number" }[] = [
  { key: "category" },
  { key: "direction" },
  { key: "seller" },
  { key: "buyer" },
  { key: "owner" },
  { key: "signer" },
  { key: "status" },
  { key: "value", kind: "number" },
];

/** Facets + danh bạ + loại hàng (ít đổi, dùng lại trong phiên). */
function useLookups() {
  const facets = useQuery({
    queryKey: FACETS_KEY,
    queryFn: ({ signal }) => fetchFacets(signal),
    staleTime: STALE_MS,
  });
  const members = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: ({ signal }) => fetchMembers(signal),
    staleTime: STALE_MS,
  });
  const cats = useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: ({ signal }) => fetchCategories(signal),
    staleTime: STALE_MS,
  });
  return { facets, members, cats };
}

export function useContractsList(categoryExtra?: ReactNode) {
  const { t: tr } = useTranslation();
  const { facets, members, cats } = useLookups();
  const memberNames = useMemo(
    () => new Map((members.data?.items ?? []).map((m) => [m.id, m.name])),
    [members.data],
  );
  const maps = useMemo(() => filterMaps(facets.data, memberNames), [facets.data, memberNames]);
  const filters: ColumnFilter<Row>[] = FILTERS.map((f) => ({
    key: f.key,
    label: tr(`contracts.list.filter.${f.key}`),
    value: () => null,
    ...(f.kind ? { kind: f.kind } : { options: optionLabels(maps[f.key as keyof FilterMaps]) }),
    ...(f.key === "category" && categoryExtra ? { extra: categoryExtra } : {}),
  }));

  // Trạng thái bảng (q/trang/lọc) sống trong `useTable`; `total` từ API nên truyền qua `serverTotal` ở lượt render sau.
  const [total, setTotal] = useState(0);
  const t = useTable<Row>(undefined, { text: () => "", filters, serverTotal: total });
  const q = useDebounced(t.q, DEBOUNCE_MS);
  const qs = listQueryString({
    q,
    conds: t.filter.conds,
    maps,
    page: t.page,
    pageSize: t.pageSize,
  });
  const list = useQuery({
    queryKey: listKey(qs),
    queryFn: ({ signal }) => fetchList(qs, signal),
    placeholderData: keepPreviousData,
  });
  const serverTotal = list.data?.total;
  useEffect(() => {
    if (serverTotal !== undefined) setTotal(serverTotal);
  }, [serverTotal]);
  return { t, list, facets, memberNames, categories: cats.data?.items ?? [] };
}
