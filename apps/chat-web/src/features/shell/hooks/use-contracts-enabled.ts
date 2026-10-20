// sso-switch · gói Sổ Hợp Tác bật + người dùng có quyền (`GET /pack/contracts/me` của Hub); lỗi/không có ⇒ false (ẩn mục).
import { api } from "@ai/web-kit/http";
import { useQuery } from "@tanstack/react-query";

export function useContractsEnabled(enabled: boolean): boolean {
  const q = useQuery({
    queryKey: ["pack", "contracts", "me"],
    queryFn: () => api<{ enabled: boolean }>("/pack/contracts/me"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.enabled === true;
}
