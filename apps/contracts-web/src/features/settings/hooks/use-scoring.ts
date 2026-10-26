// U3 · R45/R46 · truy vấn/ghi cách tính điểm đối tác (engine HD8): `/scoring/:role` (đọc · lịch sử · xem trước · lưu = version+1).
import type { PartnerRole, ScoringDraft } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchScoring,
  fetchScoringHistory,
  partnerKeys,
  previewScoring,
  saveScoring,
} from "~/features/partners/api";

export const useScoring = (role: PartnerRole) =>
  useQuery({
    queryKey: partnerKeys.scoring(role),
    queryFn: ({ signal }) => fetchScoring(role, signal),
    refetchOnWindowFocus: false,
  });

export const useScoringHistory = (role: PartnerRole) =>
  useQuery({
    queryKey: partnerKeys.history(role),
    queryFn: ({ signal }) => fetchScoringHistory(role, signal),
    refetchOnWindowFocus: false,
  });

/** Xem trước (không ghi): `draft` null = tắt. Khoá = JSON của bản nháp (đã debounce ở nơi gọi). */
export const useScoringPreview = (role: PartnerRole, draft: ScoringDraft | null) =>
  useQuery({
    queryKey: ["scoring", role, "preview", JSON.stringify(draft)],
    queryFn: () => previewScoring(role, draft as ScoringDraft),
    enabled: draft !== null,
    staleTime: 30_000,
    retry: false,
  });

/** Lưu xong làm mới cách tính, lịch sử và mọi điểm đối tác. */
export function useSaveScoring(role: PartnerRole) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: ScoringDraft) => saveScoring(role, d),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["scoring"] }),
        qc.invalidateQueries({ queryKey: ["partners"] }),
      ]),
  });
}
