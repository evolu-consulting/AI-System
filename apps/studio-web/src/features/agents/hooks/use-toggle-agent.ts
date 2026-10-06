// HUB-FR-60 · H4a-R06, R09 · bật/tắt agent: PATCH optimistic; tắt → toast + Hoàn tác (PATCH ngược với version mới).
import type { AgentList, AgentListItem } from "@ai/contracts/studio";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { meQuery } from "#/features/shell/api";
import { describeApiError } from "#/lib/api-error";
import { AGENTS_KEY, patchAgentEnabled } from "../api";

type Vars = { id: string; name: string; enabled: boolean; version: number };
type Snapshot = [readonly unknown[], AgentList | undefined][];

export function useToggleAgent() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  const patchCache = (id: string, patch: Partial<AgentListItem>) =>
    qc.setQueriesData<AgentList>({ queryKey: AGENTS_KEY }, (old) =>
      old ? { ...old, items: old.items.map((a) => (a.id === id ? { ...a, ...patch } : a)) } : old,
    );

  const m = useMutation({
    mutationFn: (v: Vars) => patchAgentEnabled(v.id, { enabled: v.enabled, version: v.version }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: AGENTS_KEY });
      const snapshot: Snapshot = qc.getQueriesData<AgentList>({ queryKey: AGENTS_KEY });
      patchCache(v.id, { enabled: v.enabled });
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      const spec = describeApiError(err);
      toast.error(t(spec.key, spec.params));
      // 409 VERSION_CONFLICT: bản đang hiện đã cũ → tải lại.
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
    },
    onSuccess: ({ agent }, v) => {
      patchCache(agent.id, { enabled: agent.enabled, version: agent.version });
      void qc.invalidateQueries({ queryKey: AGENTS_KEY });
      void qc.invalidateQueries({ queryKey: meQuery.queryKey });
      if (v.enabled) return void toast.success(t("agents.toast.enabled", { name: v.name }));
      toast(t("agents.toast.disabled", { name: v.name }), {
        action: {
          label: t("agents.toast.undo"),
          onClick: () =>
            m.mutate({ id: v.id, name: v.name, enabled: true, version: agent.version }),
        },
      });
    },
  });

  return {
    toggle: (a: AgentListItem, locale: "vi" | "en") =>
      m.mutate({ id: a.id, name: a.name[locale], enabled: !a.enabled, version: a.version }),
  };
}
