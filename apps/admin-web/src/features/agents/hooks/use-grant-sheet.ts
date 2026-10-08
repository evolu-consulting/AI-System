// HUB-FR-78 · CR-054 · ngăn "Cấp quyền · <agent>": lựa chọn cục bộ, nhóm/người của tenant (Admin API), Lưu = POST/DELETE chênh lệch.
import type { AgentGrantRow, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { pickLocalized } from "@/lib/localized";
import { useAgentGroupOptions, useAgentUserOptions, useSaveAgentGrants } from "../api";
import { type GrantSelection, grantDiff, isEmptyDiff, selectionFromRows } from "../lib/grant-draft";
import { useAgentErrorToast } from "./use-agent-actions";

type Open = { item: AgentSettingsItem; rows: AgentGrantRow[]; sel: GrantSelection };

export function useGrantSheet(tenantId: string | undefined, grantTenantId: string | undefined) {
  const { t, i18n } = useTranslation();
  const fail = useAgentErrorToast();
  const [open, setOpen] = useState<Open | null>(null);
  const groups = useAgentGroupOptions(tenantId, open !== null);
  const users = useAgentUserOptions(tenantId, open !== null);
  const save = useSaveAgentGrants(tenantId);

  const submit = async () => {
    if (!open || !grantTenantId) return;
    const diff = grantDiff(open.rows, open.sel, grantTenantId);
    if (isEmptyDiff(diff)) return setOpen(null);
    try {
      await save.mutateAsync({ agentId: open.item.agent.id, ...diff });
      notifySuccess(
        t("agents.toast.grantsSaved", {
          agent: pickLocalized(open.item.agent.name, i18n.language),
        }),
      );
      setOpen(null);
    } catch (err) {
      fail(err);
    }
  };

  return {
    open,
    groups,
    users,
    saving: save.isPending,
    show: (item: AgentSettingsItem, rows: AgentGrantRow[]) =>
      setOpen({ item, rows, sel: selectionFromRows(rows) }),
    close: () => setOpen(null),
    change: (sel: GrantSelection) => setOpen((o) => (o ? { ...o, sel } : o)),
    submit,
  };
}

export type GrantSheetState = ReturnType<typeof useGrantSheet>;
