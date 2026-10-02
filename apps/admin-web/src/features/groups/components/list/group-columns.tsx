// ADM-FR-62 · cột bảng Groups: Group (tên link + key mono, beta có "Có sẵn" + gợi ý), Thành viên, Feature, Agent ("—" tới M5), `⋯`.
import type { GroupListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pickLocalized } from "@/lib/localized";
import { GroupRowMenu } from "./GroupRowMenu";

type Handlers = {
  t: TFunction;
  lang: string;
  onEdit: (g: GroupListItem) => void;
  onDelete: (g: GroupListItem) => void;
};

export function groupColumns({ t, lang, onEdit, onDelete }: Handlers): Column<GroupListItem>[] {
  return [
    {
      id: "group",
      header: t("groups.col.group"),
      cell: (g) => (
        <div className="min-w-0">
          <Link
            to="/groups/$groupId"
            params={{ groupId: g.id }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {pickLocalized(g.name, lang)}
          </Link>{" "}
          <span className="ml-2 font-mono text-label text-muted-foreground">{g.key}</span>{" "}
          {g.is_beta ? (
            <>
              {" "}
              <StatusBadge tone="info">{t("groups.badge.builtin")}</StatusBadge>
              <p className="text-label text-muted-foreground">{t("groups.beta.hint")}</p>
            </>
          ) : null}
        </div>
      ),
    },
    { id: "members", header: t("groups.col.members"), cell: (g) => g.member_count },
    { id: "features", header: t("groups.col.features"), cell: (g) => g.feature_count },
    {
      id: "agents",
      header: t("groups.col.agents"),
      cell: (g) => (g.agent_count > 0 ? g.agent_count : "—"),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "w-12 text-right",
      cell: (g) => <GroupRowMenu group={g} onEdit={onEdit} onDelete={onDelete} />,
    },
  ];
}
