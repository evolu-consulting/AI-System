// HUB-FR-62 · H4a-R07 · bảng "Orchestrator theo tenant": dòng Mặc định (không Xoá) + mỗi tenant có bản riêng [Sửa] [Xoá].
import type { Orchestrator } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";

type Props = {
  def: Orchestrator;
  tenants: readonly Orchestrator[];
  locale: "vi" | "en";
  onEdit: (o: Orchestrator) => void;
  onDelete: (o: Orchestrator) => void;
};

const COLS = ["tenant", "agent", "steps", "updated", "actions"] as const;

const fmt = (iso: string, locale: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale);
};

function TenantRow({
  o,
  locale,
  onEdit,
  onDelete,
}: Omit<Props, "def" | "tenants"> & { o: Orchestrator }) {
  const { t } = useTranslation();
  const key = o.tenant?.key ?? "";
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{o.tenant?.name}</span>{" "}
        <span className="text-muted-foreground">({key})</span>
      </TableCell>
      <TableCell>{o.agent.key}</TableCell>
      <TableCell>{o.max_steps}</TableCell>
      <TableCell>{fmt(o.updated_at, locale)}</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        <Button
          variant="outline"
          size="sm"
          aria-label={`${t("orch.tenants.edit")} ${key}`}
          onClick={() => onEdit(o)}
        >
          {t("orch.tenants.edit")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${t("orch.tenants.delete")} ${key}`}
          onClick={() => onDelete(o)}
        >
          {t("orch.tenants.delete")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function TenantTable({ def, tenants, locale, ...actions }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table aria-label={t("orch.tenants.tableLabel")}>
          <TableHeader>
            <TableRow>
              {COLS.map((c) => (
                <TableHead key={c}>
                  <span className={c === "actions" ? "sr-only" : undefined}>
                    {t(`orch.tenants.col.${c}`)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">{t("orch.tenants.defaultRow")}</TableCell>
              <TableCell>{def.agent.key}</TableCell>
              <TableCell>{def.max_steps}</TableCell>
              <TableCell>{fmt(def.updated_at, locale)}</TableCell>
              <TableCell />
            </TableRow>
            {tenants.map((o) => (
              <TenantRow key={o.tenant?.id ?? o.id} o={o} locale={locale} {...actions} />
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-label text-muted-foreground">
        {tenants.length === 0 ? `${t("orch.tenants.empty")} ` : ""}
        {t("orch.tenants.note")}
      </p>
    </div>
  );
}
