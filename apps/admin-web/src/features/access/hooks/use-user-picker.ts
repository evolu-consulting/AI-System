// ADM-FR-36 · ô chọn người dùng của Kiểm tra quyền: gõ username/tên (debounce 300 ms) → gợi ý user trong tenant.
import { useEffect, useState } from "react";
import { useUserList } from "@/features/users/api";

const DEBOUNCE_MS = 300;

export function useUserPicker(tenantId: string | undefined, enabled: boolean) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const users = useUserList({ tenantId, q: debounced, offset: 0 }, enabled && debounced !== "");
  const options = (users.data?.items ?? []).map((u) => ({
    id: u.username,
    label: u.display_name,
    hint: u.username,
  }));
  return { options, isLoading: users.isFetching, setQuery: setQ };
}
