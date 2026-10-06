// HUB-FR-60 · H4a-R06 · xoá agent (cứng có điều kiện): 409 AGENT_IN_USE_AS_ORCHESTRATOR / HAS_HISTORY / HAS_ACCESS → toast theo mã.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { meQuery } from "#/features/shell/api";
import { describeApiError } from "#/lib/api-error";
import { AGENTS_KEY, deleteAgent } from "../api";

type Vars = { id: string; key: string; version: number };

export function useDeleteAgent() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const m = useMutation({
    mutationFn: (v: Vars) => deleteAgent(v.id, v.version),
    onSuccess: (_r, v) => {
      toast.success(t("agents.toast.deleted", { key: v.key }));
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
      void qc.invalidateQueries({ queryKey: meQuery.queryKey });
    },
    onError: (err) => {
      const spec = describeApiError(err);
      toast.error(t(spec.key, spec.params));
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
    },
  });
  return { remove: m.mutate };
}
