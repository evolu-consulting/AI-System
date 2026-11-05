// REP-v3-ui · V2-E · truy vấn/ghi cấu hình điểm uy tín: nạp `GET /reputation/config`, thử tính trên dữ liệu thật, lưu phần đã đổi.

import type { RepPreviewIn } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRepFull, previewRep, repKeys, saveRepChanged } from "../api-rep";
import { buildRep, type RepChanged } from "../lib/rep-data";
import type { RepData } from "../lib/rep-types";

export function useRepState() {
  const q = useQuery({
    queryKey: repKeys.config,
    queryFn: ({ signal }) => fetchRepFull(signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return {
    state: q.data ? buildRep(q.data) : null,
    versions: q.data?.versions,
    loading: q.isPending,
    error: q.isError,
    retry: () => void q.refetch(),
  };
}

/** Thử tính điểm uy tín (không ghi); `key` = JSON của bản nháp đã debounce, null = tắt. */
export function useRepPreview(key: string | null) {
  return useQuery({
    queryKey: ["settings", "rep-preview", key],
    queryFn: ({ signal }) => previewRep(JSON.parse(key as string) as RepPreviewIn, signal),
    enabled: key !== null,
    staleTime: 30_000,
    retry: false,
  });
}

/** Lưu xong làm mới cấu hình, `engine` và mọi điểm đối tác. */
export function useSaveRep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { data: RepData; ch: RepChanged }) => saveRepChanged(v.data, v.ch),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: repKeys.config }),
        qc.invalidateQueries({ queryKey: ["reputation"] }),
        qc.invalidateQueries({ queryKey: ["partners"] }),
      ]),
  });
}
