// HUB-FR-62 · H4a-R09 · ghi Orchestrator (mặc định / tạo / sửa / xoá bản tenant); sau ghi invalidate + `me` (badge hub config vN).
import type { OrchestratorInput, OrchestratorWriteResponse } from "@ai/contracts/studio";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AGENTS_KEY } from "#/features/agents/api";
import { meQuery } from "#/features/shell/api";
import { describeApiError } from "#/lib/api-error";
import {
  createTenantOrch,
  deleteTenantOrch,
  orchestratorQuery,
  putOrchestratorDefault,
  tenantsQuery,
  updateTenantOrch,
} from "../api";

export type SaveVars = {
  input: OrchestratorInput;
  version: number;
  /** Không có = bản mặc định; có + `create` = POST; có = PUT. */
  tenantId?: string;
  create?: boolean;
};

const send = (v: SaveVars): Promise<OrchestratorWriteResponse> => {
  if (!v.tenantId) return putOrchestratorDefault({ ...v.input, version: v.version });
  if (v.create) return createTenantOrch({ ...v.input, tenant_id: v.tenantId });
  return updateTenantOrch(v.tenantId, { ...v.input, version: v.version });
};

export function useOrchMutations() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const refresh = () => {
    for (const key of [
      orchestratorQuery.queryKey,
      tenantsQuery.queryKey,
      AGENTS_KEY,
      meQuery.queryKey,
    ])
      void qc.invalidateQueries({ queryKey: key });
  };
  const save = useMutation({
    mutationFn: send,
    onSuccess: (res) => {
      refresh();
      toast.success(t("orch.toast.saved", { n: res.hub_config_version }));
    },
  });
  const remove = useMutation({
    mutationFn: (v: { tenantId: string; version: number; name: string }) =>
      deleteTenantOrch(v.tenantId, v.version),
    onSuccess: (_r, v) => {
      refresh();
      toast.success(t("orch.toast.deleted", { tenant: v.name }));
    },
    onError: (err) => {
      const spec = describeApiError(err);
      toast.error(t(spec.key, spec.params));
      refresh();
    },
  });
  return { save: save.mutateAsync, remove: remove.mutate, reload: refresh };
}
