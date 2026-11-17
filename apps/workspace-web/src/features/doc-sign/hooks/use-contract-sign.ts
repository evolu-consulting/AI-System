// CR-181 · s13 · phiên ký của MỘT hợp đồng cho trang HĐ (bảng tài liệu, dải người ký, thẻ duyệt). Công ty tắt / lỗi ⇒ `enabled=false` (giao diện như cũ).
import type { SignSessionOut } from "@ai/contracts/pack-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSession, patchNeedsSign, sessionKey } from "../api";

export function useContractSign(id: string): {
  session: SignSessionOut | null;
  refetch: () => void;
} {
  const q = useQuery({
    queryKey: sessionKey(id),
    queryFn: ({ signal }) => fetchSession(id, signal),
    staleTime: 15_000,
    retry: false,
  });
  const s = q.data;
  return { session: s?.enabled ? s : null, refetch: () => void q.refetch() };
}

/** Bật/tắt «Cần ký» của một tệp (người tải lên, HĐ chưa khoá). */
export function useNeedsSign(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { fileId: string; on: boolean }) => patchNeedsSign(id, v.fileId, v.on),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sessionKey(id) });
      void qc.invalidateQueries({ queryKey: ["contract", id] });
    },
  });
}
