// HUB-FR-68 · HUB-BR-30 · bảng secret: Tên · Tenant (tab nguồn/KH) · Giá trị (cố định "Đã lưu", D3) · Được dùng bởi · Cập nhật · Thao tác.
import type { HubSecret, HubSecretKind } from "@ai/contracts/hub-admin";
import { memo } from "react";
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
import { UsedByCell } from "./UsedByCell";

type Actions = {
  locale: string;
  onReplace: (s: HubSecret) => void;
  onDelete: (s: HubSecret) => void;
};
type Props = Actions & { kind: HubSecretKind; items: readonly HubSecret[] };

const fmt = (iso: string, locale: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale);
};

function Row({
  s,
  showTenant,
  locale,
  onReplace,
  onDelete,
}: Actions & { s: HubSecret; showTenant: boolean }) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell id={`secret-name-${s.id}`} className="font-mono">
        {s.name}
      </TableCell>
      {showTenant ? <TableCell>{s.tenant?.name ?? t("secrets.scope.platform")}</TableCell> : null}
      <TableCell>
        <span title={`v${s.version}`} className="text-muted-foreground">
          {t("secrets.value.stored")}
        </span>
      </TableCell>
      <TableCell>
        <UsedByCell items={s.used_by} />
      </TableCell>
      <TableCell>{fmt(s.updated_at, locale)}</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        <Button
          variant="outline"
          size="sm"
          aria-describedby={`secret-name-${s.id}`}
          onClick={() => onReplace(s)}
        >
          {t("secrets.action.replace")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-describedby={`secret-name-${s.id}`}
          onClick={() => onDelete(s)}
        >
          {t("secrets.action.delete")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export const SecretTable = memo(function SecretTable({ kind, items, ...actions }: Props) {
  const { t } = useTranslation();
  const showTenant = kind !== "provider_api_key";
  const cols = ["name", ...(showTenant ? ["tenant"] : []), "value", "usedBy", "updated", "actions"];
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table aria-label={t("secrets.table.aria")}>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c}>
                <span className={c === "actions" ? "sr-only" : undefined}>
                  {t(`secrets.col.${c}`)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((s) => (
            <Row key={s.id} s={s} showTenant={showTenant} {...actions} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
});
