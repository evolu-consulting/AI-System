// esign-anchor · API vị trí ô ký: danh sách cụm theo công ty (Cài đặt › Ký số) + xem trước vị trí khi Gửi ký.
import type { ESignAnchorsIn, ESignAnchorsOut, ESignPlacementOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const ANCHORS = "/pack/contracts/esign/anchors";
export const esignAnchorsKey = ["contracts", "esign", "anchors"] as const;
export const esignPlacementKey = (id: string) => ["contracts", "esign", id, "placement"] as const;

export const fetchEsignAnchors = () => api<ESignAnchorsOut>(ANCHORS);
export const saveEsignAnchors = (b: ESignAnchorsIn) =>
  api<ESignAnchorsOut>(ANCHORS, { method: "PUT", body: b });
export const fetchEsignPlacement = (id: string) =>
  api<ESignPlacementOut>(`/pack/contracts/contracts/${encodeURIComponent(id)}/esign/placement`);

export function useEsignAnchors(onError: (e: unknown) => void) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: esignAnchorsKey, queryFn: fetchEsignAnchors, retry: false });
  const m = useMutation({
    mutationFn: saveEsignAnchors,
    onSuccess: (d) => {
      qc.setQueryData(esignAnchorsKey, d);
      void qc.invalidateQueries({ queryKey: ["contracts", "esign"], predicate: isPlacement });
    },
    onError,
  });
  return { q, m };
}
const isPlacement = (q: { queryKey: readonly unknown[] }) => q.queryKey.at(-1) === "placement";

/** Chỉ hỏi khi hộp Gửi ký mở; lỗi ⇒ không hiện dòng vị trí (không chặn gửi). */
export const useEsignPlacement = (id: string | undefined, open: boolean) =>
  useQuery({
    queryKey: esignPlacementKey(id ?? ""),
    queryFn: () => fetchEsignPlacement(id as string),
    enabled: open && !!id,
    retry: false,
  });
