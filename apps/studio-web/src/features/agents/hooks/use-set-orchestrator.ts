// HUB-FR-62 · H4a-R07 · "Đặt làm Orchestrator": đọc bản mặc định hiện tại (version + tham số giữ nguyên) rồi PUT với agent mới.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { orchestratorQuery, putOrchestratorDefault } from "#/features/orchestrator/api";
import { meQuery } from "#/features/shell/api";
import { describeApiError } from "#/lib/api-error";
import { AGENTS_KEY } from "../api";

type Vars = { agentId: string; name: string };

export function useSetOrchestrator() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const m = useMutation({
    mutationFn: async (v: Vars) => {
      const { default: cur } = await qc.fetchQuery(orchestratorQuery);
      return putOrchestratorDefault({
        agent_id: v.agentId,
        max_steps: cur.max_steps,
        token_budget: cur.token_budget,
        history_n: cur.history_n,
        on_no_match: cur.on_no_match,
        version: cur.version,
      });
    },
    onSuccess: (_r, v) => {
      toast.success(t("agents.toast.orchSet", { name: v.name }));
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
      void qc.invalidateQueries({ queryKey: orchestratorQuery.queryKey });
      void qc.invalidateQueries({ queryKey: meQuery.queryKey });
    },
    onError: (err) => {
      const spec = describeApiError(err);
      toast.error(t(spec.key, spec.params));
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
    },
  });
  return { setOrchestrator: m.mutate };
}
