// dlc-dify · section Hook của Sửa agent: mỗi sự kiện (như hook Claude CLI) chọn ≤ 1 workflow Dify; lưu riêng (PUT hooks),
// 409 → ConflictDialog. Sau lưu: cache agent nhận version mới + báo form chính (`onSynced`) để không lệch version.
import type { Agent, AgentHook, AgentHookEvent } from "@ai/contracts/studio";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConflict } from "#/components/shared/conflict/use-conflict";
import { describeApiError, type MessageSpec } from "#/lib/api-error";
import { AGENTS_KEY, agentQuery, putAgentHooks } from "../api";

type Opts = { agent: Agent; version: number; onSynced: (a: Agent) => void };
type Map_ = Partial<Record<AgentHookEvent, string>>;

const toMap = (hooks: readonly AgentHook[] | undefined): Map_ =>
  Object.fromEntries((hooks ?? []).map((h) => [h.event, h.workflow_id]));
const toList = (m: Map_): AgentHook[] =>
  Object.entries(m)
    .filter(([, w]) => !!w)
    .map(([event, workflow_id]) => ({
      event: event as AgentHookEvent,
      workflow_id: workflow_id as string,
    }));
const same = (a: Map_, b: Map_) =>
  JSON.stringify(toList(a).sort((x, y) => (x.event < y.event ? -1 : 1))) ===
  JSON.stringify(toList(b).sort((x, y) => (x.event < y.event ? -1 : 1)));

/** Lựa chọn đang sửa + bản đã lưu (để biết `dirty`). */
function useHookMaps(hooks: readonly AgentHook[] | undefined) {
  const [map, setMap] = useState<Map_>(toMap(hooks));
  const [saved, setSaved] = useState<Map_>(toMap(hooks));
  return {
    map,
    reset: (m: Map_) => {
      setMap(m);
      setSaved(m);
    },
    pick: (event: AgentHookEvent, workflowId: string | null) =>
      setMap((m) => ({ ...m, [event]: workflowId ?? undefined })),
    dirty: !same(map, saved),
  };
}

export function useAgentHooks({ agent, version, onSynced }: Opts) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const maps = useHookMaps(agent.hooks);
  const [error, setError] = useState<MessageSpec | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { hooks: AgentHook[]; version: number }) => putAgentHooks(agent.id, v),
  });
  const adopt = (a: Agent) => {
    maps.reset(toMap(a.hooks));
    setError(null);
    qc.setQueryData(agentQuery(a.id).queryKey, a);
    void qc.invalidateQueries({ queryKey: [...AGENTS_KEY], refetchType: "none" });
    onSynced(a);
  };
  const send = async (v: number) => {
    const res = await mutation.mutateAsync({ hooks: toList(maps.map), version: v });
    adopt(res.agent);
    toast.success(t("agents.hooks.saved"));
    return res;
  };
  const fail = (err: unknown) => {
    const spec = describeApiError(err);
    if ((err as { code?: unknown } | null)?.code === "INVALID_REFERENCE") setError(spec);
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
  return {
    map: maps.map,
    pick: maps.pick,
    dirty: maps.dirty,
    save,
    saving: mutation.isPending,
    error,
    conflictProps: conflict.props,
  };
}
