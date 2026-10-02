// ADM-FR-36 · M3-R13 · tab "Quyền hiệu lực" của drawer user: nạp `effective-access` (chỉ khi tab được mở vì nội dung tab nạp lười).
import { useEffectiveAccess } from "@/features/access/api";
import { ApiError } from "@/lib/http";

export function useUserAccess(userId: string) {
  const query = useEffectiveAccess(userId);
  const err = query.error instanceof ApiError ? query.error : null;
  return {
    data: query.data,
    isLoading: query.isPending,
    loadError: err ? { message: err.message, code: err.code } : null,
    retry: () => void query.refetch(),
  };
}
