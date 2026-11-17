// CR-181 · s4 · truy vấn + ghi «Chữ ký của tôi».

import type { SignatureKind } from "@ai/contracts/signature";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSignature, fetchMySignature, mySignatureKey, requestSignatureChange } from "../api";
import type { Method } from "../lib/signature-image";

export const useMySignature = (enabled = true) =>
  useQuery({
    queryKey: mySignatureKey,
    queryFn: ({ signal }) => fetchMySignature(signal),
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

export function useCreateSignature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: SignatureKind; method: Method; png: Blob }) =>
      createSignature(v.kind, v.method, v.png),
    onSuccess: () => qc.invalidateQueries({ queryKey: mySignatureKey }),
  });
}

export function useRequestChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: requestSignatureChange,
    onSuccess: () => qc.invalidateQueries({ queryKey: mySignatureKey }),
  });
}
