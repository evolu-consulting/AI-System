// ADM-FR-23 · X1 F4 · gợi ý user cho "Chạy với tư cách user…": gõ (debounce 300 ms) → user mọi tenant (platform_admin), id = user.id.
import { useEffect, useState } from "react";
import { useUserList } from "@/features/users/api";

const DEBOUNCE_MS = 300;

export function useRunAsOptions() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const users = useUserList({ tenantId: undefined, q: debounced, offset: 0 }, debounced !== "");
  const options = (users.data?.items ?? []).map((u) => ({
    id: u.id,
    label: u.display_name,
    hint: u.username,
  }));
  return { options, isLoading: users.isFetching, setQuery: setQ };
}
