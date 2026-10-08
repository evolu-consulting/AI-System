// HUB-FR-77 · CR-054 · thao tác hàng của màn Agents: đặt mặc định, đổi "Không khớp agent nào", bật/tắt cho công ty (+ toast).
import type { AgentDefaults, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { describeHubError, type MessageSpec } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { usePutAgentDefaults, usePutAgentEntitlement } from "../api";
import { defaultsForPick, defaultsFromChoice } from "../lib/agents";

/** 409 `AGENT_IS_DEFAULT` có câu riêng; còn lại theo bảng lỗi Hub chung. */
export function agentErrorKey(err: unknown): MessageSpec {
  if (err instanceof ApiError && (err.code as string) === "AGENT_IS_DEFAULT")
    return { key: "agents.error.isDefault" };
  return describeHubError(err);
}

/** Toast lỗi của màn Agents (401 đã do lớp http xử lý — không báo lại). */
export function useAgentErrorToast() {
  const tr = useTr();
  return (err: unknown) => {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
    const spec = agentErrorKey(err);
    notifyError(tr(spec.key, spec.params));
  };
}

/** agent_id → giá trị "Bật cho công ty" lạc quan đang chờ Hub. */
function usePendingMap() {
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  return {
    pending,
    put: (id: string, v: boolean) => setPending((m) => new Map(m).set(id, v)),
    drop: (id: string) =>
      setPending((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      }),
  };
}

export function useAgentActions(tenantId: string | undefined, items: AgentSettingsItem[]) {
  const { t, i18n } = useTranslation();
  const putDefaults = usePutAgentDefaults(tenantId);
  const putEntitlement = usePutAgentEntitlement(tenantId);
  const { pending, put, drop } = usePendingMap();
  const fail = useAgentErrorToast();
  const nameOf = (a: AgentSettingsItem) => pickLocalized(a.agent.name, i18n.language);

  const saveDefaults = async (body: AgentDefaults, okMessage: string) => {
    try {
      await putDefaults.mutateAsync(body);
      notifySuccess(okMessage);
    } catch (err) {
      fail(err);
    }
  };

  return {
    busy: putDefaults.isPending,
    entitledOf: (a: AgentSettingsItem) => pending.get(a.agent.id) ?? a.entitled,
    isToggling: (a: AgentSettingsItem) => pending.has(a.agent.id),
    makeDefault: (a: AgentSettingsItem, current: AgentDefaults | null) =>
      saveDefaults(
        defaultsForPick(a, current, items),
        t("agents.toast.defaultSet", { agent: nameOf(a) }),
      ),
    setNoMatch: (current: AgentDefaults, choice: string) =>
      saveDefaults(defaultsFromChoice(current, choice), t("agents.toast.noMatchSet")),
    toggleEntitled: async (a: AgentSettingsItem, entitled: boolean) => {
      if (pending.has(a.agent.id)) return;
      put(a.agent.id, entitled);
      try {
        await putEntitlement.mutateAsync({ agent_id: a.agent.id, entitled });
        const key = entitled ? "agents.toast.entitled" : "agents.toast.unentitled";
        notifySuccess(t(key, { agent: nameOf(a) }));
      } catch (err) {
        fail(err);
      } finally {
        drop(a.agent.id);
      }
    },
  };
}

export type AgentActions = ReturnType<typeof useAgentActions>;
