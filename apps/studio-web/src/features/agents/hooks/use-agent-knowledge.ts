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
import { applyToggle, isDirty, KH_MAX } from "../lib/knowledge-selection";

const SECTION_ERRORS = new Set(["KH_AGENT_RUNTIME", "KH_CONNECTION_NOT_FOUND", "VALIDATION_ERROR"]);

type Opts = { agent: Agent; version: number; onSynced: (a: Agent) => void };

/** Chọn có thứ tự: `saved` = bản đã lưu (để tính dirty). */
function useSelection(initial: string[]) {
  const [ids, setIds] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const reset = (next: string[]) => {
    setIds(next);
    setSaved(next);
  };
  const toggle = (id: string, on: boolean) => setIds((cur) => applyToggle(cur, id, on));
  const clear = () => setIds([]);
  const dirty = isDirty(ids, saved);
  return { ids, toggle, clear, reset, dirty };
}

type Sel = ReturnType<typeof useSelection>;

/** Ghi PUT + 409 + lỗi; sau lưu cache agent nhận version mới và báo form chính. */
function usePersist({ agent, version, onSynced }: Opts, sel: Sel) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [error, setError] = useState<MessageSpec | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { ids: string[]; version: number }) =>
      putAgentKnowledge(agent.id, { connection_ids: v.ids, version: v.version }),
  });
  const adopt = (a: Agent) => {
    sel.reset(a.knowledge_connection_ids ?? []);
    setError(null);
    qc.setQueryData(agentQuery(a.id).queryKey, a);
    void qc.invalidateQueries({ queryKey: [...AGENTS_KEY], refetchType: "none" });
    onSynced(a);
  };
  const send = async (v: number) => {
    const res = await mutation.mutateAsync({ ids: sel.ids, version: v });
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
  const save = async () => {
    setError(null);
    try {
      await send(version);
    } catch (err) {
      if (!conflict.capture(err, version)) fail(err);
    }
  };
  return { save, saving: mutation.isPending, error, conflictProps: conflict.props };
}

export function useAgentKnowledge(opts: Opts) {
  const sel = useSelection(opts.agent.knowledge_connection_ids ?? []);
  const persist = usePersist(opts, sel);
  return {
    ids: sel.ids,
    toggle: sel.toggle,
    clear: sel.clear,
    dirty: sel.dirty,
    ...persist,
  };
}
