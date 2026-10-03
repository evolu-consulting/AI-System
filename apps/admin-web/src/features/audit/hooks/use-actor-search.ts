// ADM-FR-51 · tìm người thực hiện cho bộ lọc Nhật ký (dùng lại API users; component không import api trực tiếp).
import { useState } from "react";
import { useUser, useUserList } from "@/features/users/api";

export function useActorSearch(value: string | undefined) {
  const [q, setQ] = useState("");
  const list = useUserList({ q: q.trim(), offset: 0 }, !value && q.trim() !== "");
  const chosen = useUser(value, !!value);
  return {
    setQ,
    isLoading: list.isFetching,
    options: (list.data?.items ?? []).map((u) => ({
      id: u.id,
      label: u.username,
      hint: u.tenant_key,
    })),
    chosenName: chosen.data?.username,
  };
}
