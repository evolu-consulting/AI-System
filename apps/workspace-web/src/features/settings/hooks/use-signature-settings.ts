// CR-181 · s5 · truy vấn + ghi Cài đặt › Chữ ký.
import type { SignatureSettings } from "@ai/contracts/signature";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mySignatureKey } from "~/features/my-signature/api";
import {
  fetchChangeRequests,
  fetchSignatureSettings,
  grantChange,
  saveSignatureSettings,
  signatureKeys,
} from "../api-signature";

export const useSignatureSettings = () =>
  useQuery({
    queryKey: signatureKeys.settings,
    queryFn: ({ signal }) => fetchSignatureSettings(signal),
    retry: false,
  });

export function useSaveSignatureSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: SignatureSettings) => saveSignatureSettings(b),
    onSuccess: (v) => {
      qc.setQueryData(signatureKeys.settings, v);
      void qc.invalidateQueries({ queryKey: mySignatureKey }); // «Chữ ký của tôi» đọc định dạng mới
    },
  });
}

/** Chỉ quản trị gọi được (người thường 403) ⇒ `enabled` theo `can_edit`. */
export const useChangeRequests = (enabled: boolean) =>
  useQuery({
    queryKey: signatureKeys.requests,
    queryFn: ({ signal }) => fetchChangeRequests(signal),
    enabled,
    retry: false,
  });

export function useGrantChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => grantChange(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: signatureKeys.requests }),
  });
}
