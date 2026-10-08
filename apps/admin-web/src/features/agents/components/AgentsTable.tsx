// HUB-FR-77 · HUB-FR-78 · CR-054 · bảng "Agent của công ty": Agent · Model · Chạy bằng · Bật cho công ty · Ai được dùng · Thao tác.
import type { AgentDefaults, AgentGrantRow, AgentSettingsItem } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/states/EmptyState";
import type { AgentActions } from "../hooks/use-agent-actions";
import { runtimeKey } from "../lib/agents";
import { AgentCell } from "./AgentCell";
import { EntitledSwitch, ModelCell, RowActions, WhoCell } from "./AgentCells";

type Props = {
  items: AgentSettingsItem[] | undefined;
  defaults: AgentDefaults | null;
  grantRows: ReadonlyMap<string, AgentGrantRow[]>;
  isPlatform: boolean;
  loading: boolean;
  actions: AgentActions;
  onGrant: (item: AgentSettingsItem) => void;
};

const NO_ROWS: AgentGrantRow[] = [];

type Tr = ReturnType<typeof useTranslation>["t"];

/** Cột trái: Agent · Model · Chạy bằng. */
function infoColumns(p: Props, t: Tr): Column<AgentSettingsItem>[] {
  const all = p.items ?? [];
  return [
    {
      id: "agent",
      header: t("agents.col.agent"),
      className: "min-w-72 whitespace-normal",
      cell: (row) => (
        <AgentCell
          item={row}
          items={all}
          defaults={p.defaults}
          busy={p.actions.busy}
          onNoMatch={(cur, choice) => void p.actions.setNoMatch(cur, choice)}
        />
      ),
    },
    { id: "model", header: t("agents.col.model"), cell: (row) => <ModelCell item={row} /> },
    {
      id: "runtime",
      header: t("agents.col.runtime"),
      cell: (row) => {
        const key = runtimeKey(row.runtime);
        return key ? t(key) : row.runtime;
      },
    },
  ];
}

/** Cột phải: Bật cho công ty · Ai được dùng · Thao tác. */
function accessColumns(p: Props, t: Tr): Column<AgentSettingsItem>[] {
  const { actions } = p;
  return [
    {
      id: "entitled",
      header: t("agents.col.entitled"),
      cell: (row) => (
        <EntitledSwitch
          item={row}
          checked={actions.entitledOf(row)}
          canEdit={p.isPlatform}
          pending={actions.isToggling(row)}
          onToggle={(item, on) => void actions.toggleEntitled(item, on)}
        />
      ),
    },
    {
      id: "who",
      header: t("agents.col.who"),
      className: "whitespace-normal",
      cell: (row) => <WhoCell item={row} rows={p.grantRows.get(row.agent.id) ?? NO_ROWS} />,
    },
    {
      id: "actions",
      header: <span className="sr-only sm:not-sr-only">{t("agents.col.actions")}</span>,
      className: "text-right",
      cell: (row) => (
        <RowActions
          item={row}
          isDefault={p.defaults?.default_agent_id === row.agent.id}
          busy={actions.busy}
          onMakeDefault={() => void actions.makeDefault(row, p.defaults)}
          onGrant={() => p.onGrant(row)}
        />
      ),
    },
  ];
}

export function AgentsTable(p: Props) {
  const { t } = useTranslation();
  // Bảng nhỏ (≤ 200 agent, thường < 10): dựng cột mỗi lần render, không memo.
  const columns = [...infoColumns(p, t), ...accessColumns(p, t)];
  return (
    <DataTable
      caption={t("agents.list.title")}
      columns={columns}
      rows={p.items}
      getRowKey={(row) => row.agent.id}
      isLoading={p.loading}
      empty={<EmptyState message={t("agents.list.empty")} />}
      skeletonRows={4}
    />
  );
}
