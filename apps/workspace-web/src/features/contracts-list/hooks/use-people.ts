// CR-127 · U4b-1 · danh sách người để «Chuyển cho…» (danh bạ công ty; máy chủ kiểm người nhận thuộc phòng của bước).
import { useQuery } from "@tanstack/react-query";
import type { Person } from "~/platform/flow";
import { fetchMembers, MEMBERS_KEY } from "../api";

export function usePeople(enabled: boolean): readonly Person[] | undefined {
  const q = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: ({ signal }) => fetchMembers(signal),
    staleTime: 5 * 60_000,
    enabled,
  });
  return q.data?.items;
}
