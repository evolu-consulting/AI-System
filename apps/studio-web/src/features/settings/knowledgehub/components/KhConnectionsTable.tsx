// HUB-FR-131 · mockup 1 · bảng kết nối: Tên · Địa chỉ · Khoá · Project ghi Tóm tắt · Trạng thái · Agent dùng · [Kiểm tra][Sửa][Xoá].
import type { KhConnection, KhConnectionStatus } from "@ai/contracts/hub-admin";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";

const VARIANT = { unchecked: "off", ok: "ok", error: "err" } as const satisfies Record<
  KhConnectionStatus,
  "off" | "ok" | "err"
>;
const COLS = ["name", "url", "key", "project", "status", "agents", "actions"] as const;

type Actions = {
  checking: boolean;
  onCheck: (c: KhConnection) => void;
  onEdit: (c: KhConnection) => void;
  onDelete: (c: KhConnection) => void;
};

function Row({ c, checking, onCheck, onEdit, onDelete }: Actions & { c: KhConnection }) {
  const { t } = useTranslation();
  const label = (a: "check" | "edit" | "delete") => `${t(`knowledgehub.action.${a}`)} ${c.name}`;
  return (
    <TableRow>
      <TableCell className="font-mono">{c.name}</TableCell>
      <TableCell className="font-mono break-all">{c.base_url}</TableCell>
      <TableCell className="font-mono">{c.secret.name}</TableCell>
      <TableCell className="font-mono">{c.summary_project ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={VARIANT[c.status]}>{t(`knowledgehub.status.${c.status}`)}</Badge>
      </TableCell>
      <TableCell>{c.agents_count}</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        <Button
          variant="outline"
          size="sm"
          aria-label={label("check")}
          disabled={checking}
          onClick={() => onCheck(c)}
        >
          {t("knowledgehub.action.check")}
        </Button>
        <Button variant="outline" size="sm" aria-label={label("edit")} onClick={() => onEdit(c)}>
          {t("knowledgehub.action.edit")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={label("delete")}
          onClick={() => onDelete(c)}
        >
          {t("knowledgehub.action.delete")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export const KhConnectionsTable = memo(function KhConnectionsTable({
  items,
  ...actions
}: Actions & { items: readonly KhConnection[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table aria-label={t("knowledgehub.section")}>
        <TableHeader>
          <TableRow>
            {COLS.map((c) => (
              <TableHead key={c}>
                <span className={c === "actions" ? "sr-only" : undefined}>
                  {t(`knowledgehub.col.${c}`)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((c) => (
            <Row key={c.id} c={c} {...actions} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
});
