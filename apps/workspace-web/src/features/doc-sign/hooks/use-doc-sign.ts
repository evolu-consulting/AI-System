// Cổng hook cho component (component-no-fetch): phiên ký, chữ ký của tôi, ghi chỗ ký / ký.
import type { SignFieldsPut } from "@ai/contracts/pack-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchContent,
  fetchMySignature,
  fetchSession,
  mySignatureKey,
  patchNeedsSign,
  postSign,
  putFields,
  saveMySignature,
  sessionKey,
} from "../api";
import type { SignPostBody } from "../lib/session-map";

export { fetchContent };

export function useDocSign(id: string) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: sessionKey(id),
    queryFn: ({ signal }) => fetchSession(id, signal),
    staleTime: 0,
  });
  const mine = useQuery({
    queryKey: mySignatureKey,
    queryFn: ({ signal }) => fetchMySignature(signal),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: sessionKey(id) });
    void qc.invalidateQueries({ queryKey: ["contract", id] });
  };
  const needsSign = useMutation({
    mutationFn: (v: { fileId: string; on: boolean }) => patchNeedsSign(id, v.fileId, v.on),
    onSuccess: refresh,
  });
  const savePlaces = useMutation({
    mutationFn: (v: { fileId: string; body: SignFieldsPut }) => putFields(id, v.fileId, v.body),
  });
  const sign = useMutation({
    mutationFn: (v: { fileId: string; body: SignPostBody }) => postSign(id, v.fileId, v.body),
  });
  const saveSignature = useMutation({
    mutationFn: saveMySignature,
    onSuccess: () => qc.invalidateQueries({ queryKey: mySignatureKey }),
  });
  return { session, mine, needsSign, savePlaces, sign, saveSignature, refresh };
}
