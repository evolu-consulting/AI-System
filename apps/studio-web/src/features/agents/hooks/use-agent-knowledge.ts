// HUB-FR-132 · section KnowledgeHub của Sửa agent: tick có thứ tự (≤ 5), lưu riêng, 409 → ConflictDialog.
// Sau lưu: cache agent cập nhật bằng version mới + báo form chính (`onSynced`) để không lệch version.
import type { Agent } from "@ai/contracts/studio";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { meQuery } from "#/features/shell/api";
import { describeApiError, type MessageSpec } from "#/lib/api-error";
import { AGENTS_KEY, agentQuery, putAgentKnowledge } from "../api";

export const KH_MAX = 5;
const SECTION_ERRORS = new Set(["KH_AGENT_RUNTIME", "KH_CONNECTION_NOT_FOUND", "VALIDATION_ERROR"]);

type Opts = { agent: Agent; version: number; onSynced: (a: Agent) => void };

export function useAgentKnowledge({ agent, version, onSynced }: Opts) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>(agent.knowledge_connection_ids ?? []);
  const [saved, setSaved] = useState<string[]>(agent.knowledge_connection_ids ?? []);
  const [error, setError] = useState<MessageSpec | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { ids: string[]; version: number }) =>
      putAgentKnowledge(agent.id, { connection_ids: v.ids, version: v.version }),
  });
  const adopt = (a: Agent) => {
    const next = a.knowledge_connection_ids ?? [];
    setIds(next);
    setSaved(next);
    setError(null);
    qc.setQueryData(agentQuery(a.id).queryKey, a);
    void qc.invalidateQueries({ queryKey: [...AGENTS_KEY], refetchType: "none" });
    onSynced(a);
  };
  const send = async (v: number) => {
    const res = await mutation.mutateAsync({ ids, version: v });
    adopt(res.agent);
    void qc.invalidateQueries({ queryKey: meQuery.queryKey });
    toast.success(t("agents.knowledge.saved"));
    return res;
  };
  const fail = (err: unknown) => {
    const code = (err as { code?: unknown } | null)?.code;
    const spec = describeApiError(err);
    if (typeof code === "string" && SECTION_ERRORS.has(code)) setError(spec);
    else toast.error(t(spec.key, spec.params));
  };
  const conflict = useConflict<Agent>({
    buildRows: () => ({ rows: [], more: 0 }),
    submit: send,
    onReload: adopt,
    onError: fail,
  });
  const toggle = (id: string, on: boolean) =>
    setIds((cur) => {
      if (!on) return cur.filter((x) => x !== id);
      return cur.includes(id) || cur.length >= KH_MAX ? cur : [...cur, id];
    });
  const save = async () => {
    setError(null);
    try {
      await send(version);
    } catch (err) {
      if (!conflict.capture(err, version)) fail(err);
    }
  };
  const dirty = JSON.stringify(ids) !== JSON.stringify(saved);
  return {
    ids,
    toggle,
    save,
    dirty,
    saving: mutation.isPending,
    error,
    conflictProps: conflict.props,
  };
}
