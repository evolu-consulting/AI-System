// agents-background · mục "Agent chạy nền của app": agent không chat được (cờ `surface = background` của Hub) chạy thay cho một app /
// tính năng. Cột: Agent · Phục vụ · Model·bậc · Chạy bằng · Bật cho công ty · Dùng tháng này · Trần tháng · Thao tác.
// Không có "Cấp quyền" / "Đặt mặc định" (không cấp quyền, không @mention).
import type { MeApp } from "@ai/contracts";
import type { AgentSettingsItem } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pickLocalized } from "@/lib/localized";
import type { AgentActions } from "../hooks/use-agent-actions";
import { runtimeKey } from "../lib/agents";
import { type AgentUsage, studioAgentUrl } from "../lib/background";
import { EntitledSwitch, ModelCell } from "./AgentCells";

export type BackgroundUsage = {
  loading: boolean;
  failed: boolean;
  byAgent: ReadonlyMap<string, AgentUsage>;
};

type Props = {
  items: AgentSettingsItem[] | undefined;
  actions: AgentActions;
  isPlatform: boolean;
  loading: boolean;
  usage: BackgroundUsage;
  /** Mã công ty đang xem (platform) — giữ nguyên khi chuyển sang màn Usage. */
  tenantKey: string | null;
  apps: readonly MeApp[];
};

type Tr = ReturnType<typeof useTranslation>["t"];
const NONE = <span className="text-muted-foreground">—</span>;

function NameCell({ row, lang }: { row: AgentSettingsItem; lang: string }) {
  const name = pickLocalized(row.agent.name, lang);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium">{name}</span>
      <span className="text-label text-muted-foreground">
        <span className="font-mono">{row.agent.key}</span>
        {row.description ? ` · ${row.description}` : null}
      </span>
    </div>
  );
}

function UsageCell({ row, p, t }: { row: AgentSettingsItem; p: Props; t: Tr }) {
  if (p.usage.failed) return <span className="text-label">{t("agents.bg.usageError")}</span>;
  if (p.usage.loading) return NONE;
  const u = p.usage.byAgent.get(row.agent.id) ?? { calls: 0, tokens: 0 };
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        {t("agents.bg.usage", {
          calls: u.calls.toLocaleString(),
          tokens: u.tokens.toLocaleString(),
        })}
      </span>
      <Link
        to="/usage/analytics"
        search={{ agent: row.agent.id, preset: "month", tenant: p.tenantKey ?? undefined }}
        className="text-label text-primary underline-offset-2 hover:underline"
      >
        {t("agents.bg.usageLink")}
      </Link>
    </div>
  );
}

function CapCell({ row, p, t, lang }: { row: AgentSettingsItem; p: Props; t: Tr; lang: string }) {
  const app = row.serves ? p.apps.find((a) => a.key === row.serves?.app) : undefined;
  if (!app || app.url === "") return <span className="text-label">{t("agents.bg.capNone")}</span>;
  const label = app.name.en && lang.startsWith("en") ? app.name.en : app.name.vi;
  return (
    <a
      href={app.url}
      target="_blank"
      rel="noreferrer"
      className="text-label text-primary underline-offset-2 hover:underline"
    >
      {t("agents.bg.capIn", { app: label })}
    </a>
  );
}

function columns(p: Props, t: Tr, lang: string): Column<AgentSettingsItem>[] {
  const studio = p.apps.find((a) => a.key === "studio")?.url;
  return [
    {
      id: "agent",
      header: t("agents.bg.col.agent"),
      className: "min-w-64 whitespace-normal",
      cell: (row) => <NameCell row={row} lang={lang} />,
    },
    {
      id: "serves",
      header: t("agents.bg.col.serves"),
      className: "whitespace-normal",
      cell: (row) => (row.serves ? pickLocalized(row.serves.label, lang) : NONE),
    },
    {
      id: "model",
      header: t("agents.bg.col.model"),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <ModelCell item={row} />
          {row.tier ? (
            <Badge variant="secondary">{t(`agents.bg.tier.${row.tier}`, row.tier)}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: "runtime",
      header: t("agents.col.runtime"),
      cell: (row) => {
        const key = runtimeKey(row.runtime);
        return key ? t(key) : row.runtime;
      },
    },
    {
      id: "entitled",
      header: t("agents.col.entitled"),
      className: "whitespace-normal",
      cell: (row) => {
        const on = p.actions.entitledOf(row);
        return (
          <div className="flex flex-col gap-1">
            <EntitledSwitch
              item={row}
              checked={on}
              canEdit={p.isPlatform}
              pending={p.actions.isToggling(row)}
              onToggle={(item, v) => void p.actions.toggleEntitled(item, v)}
            />
            {on ? null : <StatusBadge tone="off">{t("agents.bg.offHint")}</StatusBadge>}
          </div>
        );
      },
    },
    {
      id: "usage",
      header: t("agents.bg.col.usage"),
      className: "whitespace-normal",
      cell: (row) => <UsageCell row={row} p={p} t={t} />,
    },
    {
      id: "cap",
      header: t("agents.bg.col.cap"),
      className: "whitespace-normal",
      cell: (row) => <CapCell row={row} p={p} t={t} lang={lang} />,
    },
    {
      id: "actions",
      header: <span className="sr-only sm:not-sr-only">{t("agents.bg.col.actions")}</span>,
      className: "text-right",
      cell: (row) => {
        const url = p.isPlatform ? studioAgentUrl(studio, row.agent.id) : null;
        if (!url) return null;
        const name = pickLocalized(row.agent.name, lang);
        return (
          <Button asChild variant="outline" size="sm">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("agents.bg.openStudioAria", { agent: name })}
            >
              {t("agents.bg.openStudio")}
            </a>
          </Button>
        );
      },
    },
  ];
}

export function BackgroundAgentsTable(p: Props) {
  const { t, i18n } = useTranslation();
  return (
    <DataTable
      caption={t("agents.bg.title")}
      columns={columns(p, t, i18n.language)}
      rows={p.items}
      getRowKey={(row) => row.agent.id}
      isLoading={p.loading}
      empty={<EmptyState message={t("agents.bg.empty")} />}
      skeletonRows={2}
    />
  );
}
