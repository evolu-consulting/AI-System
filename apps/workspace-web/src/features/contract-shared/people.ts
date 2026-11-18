// CR-184 · thẻ người theo lô (`GET /people?ids=`): ảnh đại diện + chức vụ cho avatar người phụ trách / người ký (CR-147 là nguồn ảnh).
import type { PeopleResponse, PersonCard } from "@ai/contracts/people";
import { api } from "@ai/web-kit/http";
import { useQuery } from "@tanstack/react-query";

export function usePeopleCards(
  ids: readonly (string | null | undefined)[],
): Map<string, PersonCard> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))].slice(0, 50);
  const q = useQuery({
    queryKey: ["people", "cards", uniq.join(",")],
    enabled: uniq.length > 0,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api<PeopleResponse>("/people", { query: { ids: uniq.join(",") }, signal }),
  });
  return new Map((q.data?.items ?? []).map((p) => [p.user_id, p]));
}
