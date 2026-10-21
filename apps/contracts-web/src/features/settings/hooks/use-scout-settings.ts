// price-scout · truy vấn/ghi mặc định nhóm + trần lượt dò (Cài đặt). Lưu xong cập nhật thẳng cache; cấu hình SP đang mở tải lại.
import type { PriceScoutConfig, PriceScoutGroup, PriceScoutQuotaIn } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchScoutDefaults,
  fetchScoutQuota,
  saveScoutDefaults,
  saveScoutQuota,
  scoutSettingsKeys,
} from "../scout-api";

export const useScoutDefaults = () =>
  useQuery({
    queryKey: scoutSettingsKeys.defaults,
    queryFn: ({ signal }) => fetchScoutDefaults(signal),
  });

export const useScoutQuota = () =>
  useQuery({
    queryKey: scoutSettingsKeys.quota,
    queryFn: ({ signal }) => fetchScoutQuota(signal),
  });

export function useSaveScoutDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { group: PriceScoutGroup; config: PriceScoutConfig }) =>
      saveScoutDefaults(v.group, v.config),
    onSuccess: (d) => {
      qc.setQueryData(scoutSettingsKeys.defaults, d);
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useSaveScoutQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PriceScoutQuotaIn) => saveScoutQuota(body),
    onSuccess: (d) => {
      qc.setQueryData(scoutSettingsKeys.quota, d);
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
