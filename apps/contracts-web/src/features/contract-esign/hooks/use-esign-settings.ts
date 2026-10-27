// cf-esign-docusign · cài đặt ký số của công ty (GET/PUT /esign/settings): bật/tắt + nhà cung cấp mặc định (esign-multi).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { esignSettingsKey, fetchEsignSettings, saveEsignSettings } from "../api";

export function useEsignSettings(onError: (e: unknown) => void) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: esignSettingsKey, queryFn: fetchEsignSettings, retry: false });
  const m = useMutation({
    mutationFn: saveEsignSettings,
    onSuccess: (d) => qc.setQueryData(esignSettingsKey, d),
    onError,
  });
  return { q, m };
}
