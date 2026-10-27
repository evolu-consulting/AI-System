// cf-esign-docusign · cài đặt bật/tắt ký số của công ty (GET/PUT /esign/settings).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { esignSettingsKey, fetchEsignSettings, saveEsignSettings } from "../api";

export function useEsignSettings(onError: () => void) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: esignSettingsKey, queryFn: fetchEsignSettings, retry: false });
  const m = useMutation({
    mutationFn: saveEsignSettings,
    onSuccess: (d) => qc.setQueryData(esignSettingsKey, d),
    onError,
  });
  return { q, m };
}
