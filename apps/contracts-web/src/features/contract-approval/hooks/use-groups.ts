// contract-flow S4: Group của tenant (id + tên) — một nguồn cho thẻ duyệt (tên phòng) và mẫu luồng (chọn phòng).
import { useQuery } from "@tanstack/react-query";
import { fetchGroups, groupsKey } from "../api";

export const useGroups = (enabled = true) =>
  useQuery({
    queryKey: groupsKey,
    queryFn: ({ signal }) => fetchGroups(signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
