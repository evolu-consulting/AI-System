// CR-181 · s4 · truy vấn + ghi «Chữ ký của tôi».

import type { SignatureKind } from "@ai/contracts/signature";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSignature,
  fetchMySignature,
  fetchSigDocs,
  mySignatureKey,
  requestSignatureChange,
  type SigDocsFilter,
  sigDocsKey,
} from "../api";
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
    mutationFn: (v: { kind: SignatureKind; method: Method; png: Blob; caption: string | null }) =>
      createSignature(v.kind, v.method, v.png, v.caption),
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

/** CR-188 · BR-188-5 · «Giấy tờ đã ký bằng chữ ký này»: nạp trang đầu, «Xem thêm» nối con trỏ. */
export const useSigDocs = (sigId: string | null, f: SigDocsFilter) =>
  useInfiniteQuery({
    queryKey: sigDocsKey(sigId ?? "", f),
    enabled: sigId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchSigDocs(sigId as string, f, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor,
    retry: false,
    refetchOnWindowFocus: false,
  });
