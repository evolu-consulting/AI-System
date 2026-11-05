// REP-v3-ui · truy vấn/ghi uy tín theo engine V2-E (BA v2.0 §5.1): cờ `engine` (`GET /reputation/config`), bảng điểm vai × nhóm SP, chi tiết,
// lịch sử chốt tháng, đánh giá sao, "Cần chú ý" (TQ-04), xem trước đổi mức (quản lý). Chỉ bật các truy vấn V2-E khi `engine = v2e`.
import type { RepEngine, RepRatingIn, RepRole } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRepAttention,
  fetchRepDetail,
  fetchRepEngine,
  fetchRepHistory,
  fetchRepPartners,
  fetchRepRatings,
  fetchSwitchPreview,
  partnerKeys,
  rateRep,
} from "../api";
import type { Range } from "../lib/partner-v2e";

/** Cấu hình uy tín (`engine` + mức/đánh giá). Lỗi tải ⇒ coi như `hd8` (cùng quy tắc fail-closed của máy chủ). */
export const useRepConfig = () =>
  useQuery({
    queryKey: partnerKeys.engine,
    queryFn: ({ signal }) => fetchRepEngine(signal),
    staleTime: 60_000,
    retry: false,
  });

export type EngineState = { engine: RepEngine | undefined; loading: boolean };
/** Engine hiện hành; `undefined` trong lúc tải (màn hình chờ, không nháy sai engine). */
export function useEngine(): EngineState {
  const q = useRepConfig();
  return { engine: q.data?.engine ?? (q.isError ? "hd8" : undefined), loading: q.isPending };
}

export const useRepPartners = (enabled: boolean) =>
  useQuery({
    queryKey: partnerKeys.repList,
    queryFn: ({ signal }) => fetchRepPartners(signal),
    enabled,
  });

export const useRepAttention = (enabled: boolean) =>
  useQuery({
    queryKey: partnerKeys.attention,
    queryFn: ({ signal }) => fetchRepAttention(signal),
    enabled,
  });

/** Quản lý xem trước "N đối tác đổi mức nếu bật V2-E" (chỉ đọc). */
export const useSwitchPreview = (enabled: boolean) =>
  useQuery({
    queryKey: partnerKeys.switchPreview,
    queryFn: ({ signal }) => fetchSwitchPreview(signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });

export const useRepDetail = (party: string, role: RepRole) =>
  useQuery({
    queryKey: partnerKeys.detail(party, role),
    queryFn: ({ signal }) => fetchRepDetail(party, role, signal),
    retry: false,
  });

export const useRepRatings = (party: string, role: RepRole) =>
  useQuery({
    queryKey: partnerKeys.repRatings(party, role),
    queryFn: ({ signal }) => fetchRepRatings(party, role, signal),
  });

export const useRepHistory = (party: string, role: RepRole, range: Range) =>
  useQuery({
    queryKey: partnerKeys.repHistory(party, role, range),
    queryFn: ({ signal }) => fetchRepHistory(party, role, range, signal),
  });

/** Đánh giá 1 tiêu chí: `onDone` chạy ngay khi ghi xong, `onSaved` sau khi làm mới dữ liệu. */
export function useRateRep(h: { onDone: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: RepRatingIn) => rateRep(b),
    onSuccess: async () => {
      h.onDone();
      await qc.invalidateQueries({ queryKey: ["partners"] });
      h.onSaved();
    },
  });
}
