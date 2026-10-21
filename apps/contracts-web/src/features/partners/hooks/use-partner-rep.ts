// V2-I · truy vấn/ghi uy tín đối tác (chi tiết · cấu hình · đánh giá · lịch sử · hợp đồng · ghi chú · liên hệ · tìm internet).
import type { PartnerWebLine, RepRatingIn, RepRole } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addNote,
  createCompany,
  deleteNote,
  fetchContacts,
  fetchNotes,
  fetchPartnerContracts,
  fetchRepConfig,
  fetchRepDetail,
  fetchRepHistory,
  fetchRepMine,
  fetchRepPartners,
  fetchRepRatings,
  type PartnerContactDraft,
  partnerKeys,
  rateRep,
  saveContacts,
  saveProfile,
  searchInternet,
} from "../api";
import { noteOfLine, type Range } from "../lib/partner-v2";

export const useRepPartners = () =>
  useQuery({ queryKey: partnerKeys.repList, queryFn: ({ signal }) => fetchRepPartners(signal) });

export const useRepDetail = (party: string, role: RepRole) =>
  useQuery({
    queryKey: partnerKeys.detail(party, role),
    queryFn: ({ signal }) => fetchRepDetail(party, role, signal),
    retry: false,
  });

/** 404 = đối tác chưa có việc/HĐ nào để chấm (nhãn MỚI) — không phải lỗi. */
export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

export const useRepConfig = () =>
  useQuery({ queryKey: partnerKeys.repConfig, queryFn: ({ signal }) => fetchRepConfig(signal) });

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

export const useRepMine = (days: number) =>
  useQuery({
    queryKey: partnerKeys.mine(days),
    queryFn: ({ signal }) => fetchRepMine(days, signal),
  });

export const usePartnerContracts = (party: string) =>
  useQuery({
    queryKey: partnerKeys.contracts(party),
    queryFn: ({ signal }) => fetchPartnerContracts(party, signal),
  });

export const useNotes = (party: string) =>
  useQuery({
    queryKey: partnerKeys.notes(party),
    queryFn: ({ signal }) => fetchNotes(party, signal),
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

export function useAddNote(party: string, h: { onDone: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addNote({ party, body }),
    onSuccess: async () => {
      h.onDone();
      await qc.invalidateQueries({ queryKey: partnerKeys.notes(party) });
      h.onSaved();
    },
  });
}

export function useDeleteNote(party: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerKeys.notes(party) }),
  });
}

/** Lưu dòng kết quả tìm internet thành ghi chú (nguồn `internet`). */
export function useSaveWebLine(
  party: string,
  lines: PartnerWebLine[],
  h: { onDone: (i: number) => void; onSaved: () => void },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: number) =>
      addNote({ party, body: noteOfLine(lines[i] as PartnerWebLine), source: "internet" }),
    onSuccess: async (_n, i) => {
      h.onDone(i);
      await qc.invalidateQueries({ queryKey: partnerKeys.notes(party) });
      h.onSaved();
    },
  });
}

export function useSaveProfile(party: string, onSaved: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { phone: string; contact: string }) => saveProfile({ party, ...v }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: partnerKeys.profile(party) });
      onSaved();
    },
  });
}

/** GAP-D2 · #24: danh sách người liên hệ của đối tác. */
export const useContacts = (party: string) =>
  useQuery({
    queryKey: partnerKeys.contacts(party),
    queryFn: ({ signal }) => fetchContacts(party, signal),
  });

/** Thay cả danh sách; xong làm mới danh sách + hồ sơ (đầu trang lấy người đầu tiên). */
export function useSaveContacts(party: string, onSaved: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: PartnerContactDraft[]) => saveContacts(party, rows),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partners"] });
      onSaved();
    },
  });
}

/** GAP-D2 · #23: thêm công ty theo MST (máy chủ tra Cục Thuế chỉ bằng MST) / tra lại. */
export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { tax_id?: string; name?: string; address?: string }) => createCompany(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partners"] }),
  });
}

/** Mã lỗi của máy chủ (`AGENT_UNAVAILABLE` 503 · `AI_CAP_EXCEEDED` 429) ⇒ khoá câu báo; còn lại ⇒ chung. */
export const searchErrorKey = (e: unknown): "unavailable" | "cap" | "failed" => {
  const code = e instanceof ApiError ? String(e.code) : "";
  return code === "AGENT_UNAVAILABLE"
    ? "unavailable"
    : code === "AI_CAP_EXCEEDED"
      ? "cap"
      : "failed";
};

export function useInternetSearch(party: string) {
  return useMutation({ mutationFn: () => searchInternet(party) });
}
