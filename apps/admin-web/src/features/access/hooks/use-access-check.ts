// ADM-FR-36 · M3-R12, R13 · Kiểm tra quyền: username (URL `?user=`) → user trong tenant → `effective-access`; không thấy → "không tìm thấy".
import { useUserByUsername } from "@/features/users/api";
import { ApiError } from "@/lib/http";
import { useEffectiveAccess } from "../api";

type Args = { tenantId: string | undefined; username: string | undefined; enabled: boolean };

export function useAccessCheck({ tenantId, username, enabled }: Args) {
  const lookup = useUserByUsername(tenantId, username, enabled);
  const found = lookup.data ?? undefined;
  const access = useEffectiveAccess(found?.id, enabled);
  const err =
    access.error instanceof ApiError
      ? access.error
      : lookup.error instanceof ApiError
        ? lookup.error
        : null;
  return {
    data: access.data,
    isLoading:
      !!username && (lookup.isPending || lookup.isPlaceholderData || (!!found && access.isPending)),
    notFound: !!username && lookup.isSuccess && !lookup.isPlaceholderData && !found,
    loadError: err ? { message: err.message, code: err.code } : null,
    retry: () => void (found ? access.refetch() : lookup.refetch()),
  };
}
