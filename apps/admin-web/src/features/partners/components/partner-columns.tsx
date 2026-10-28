// ADM-FR-74 · cột bảng công ty đối tác: tên (mở danh sách tài khoản), số tài khoản (hoạt động/tổng), trạng thái, menu `⋯`.
import type { ExternalOrg } from "@ai/contracts";
import type { TFunction } from "i18next";
import { MoreHorizontal } from "lucide-react";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type PartnerColumnOpts = {
  t: TFunction;
  onOpen: (o: ExternalOrg) => void;
  onRename: (o: ExternalOrg) => void;
  onDeactivate: (o: ExternalOrg) => void;
};

function RowMenu({
  org,
  t,
  onOpen,
  onRename,
  onDeactivate,
}: PartnerColumnOpts & { org: ExternalOrg }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(org)}>{t("partners.menu.open")}</DropdownMenuItem>
        {org.active ? (
          <>
            <DropdownMenuItem onSelect={() => onRename(org)}>
              {t("partners.menu.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDeactivate(org)}>
              {t("partners.menu.deactivate")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function partnerColumns(opts: PartnerColumnOpts): Column<ExternalOrg>[] {
  const { t, onOpen } = opts;
  return [
    {
      id: "name",
      header: t("partners.col.name"),
      cell: (o) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-4 hover:underline focus-visible:underline"
          onClick={() => onOpen(o)}
        >
          {o.name}
        </button>
      ),
    },
    {
      id: "accounts",
      header: t("partners.col.accounts"),
      cell: (o) => (
        <span className="font-mono">
          {o.active_user_count}/{o.user_count}
        </span>
      ),
    },
    {
      id: "status",
      header: t("partners.col.status"),
      cell: (o) => (
        <StatusBadge tone={o.active ? "ok" : "off"}>
          {t(o.active ? "partners.status.active" : "partners.status.inactive")}
        </StatusBadge>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "w-12 text-right",
      cell: (o) => <RowMenu org={o} {...opts} />,
    },
  ];
}
