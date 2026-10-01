// ADM-FR-55 · M3-R20 · bảng khác biệt 3 cột Trường · Bản của bạn · Bản mới nhất (v{n}); chỉ hiện trường khác.
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DiffRow } from "@/lib/diff-fields";

type Props = { rows: DiffRow[]; more: number; latestVersion: number };

function Cell({ value, empty }: { value: string; empty: boolean }) {
  const { t } = useTranslation();
  return (
    <TableCell className="max-w-56 whitespace-normal break-words font-mono text-label">
      {empty ? <span className="text-muted-foreground">{t("conflict.diff.none")}</span> : value}
    </TableCell>
  );
}

export function DiffTable({ rows, more, latestVersion }: Props) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <p className="text-body text-muted-foreground">{t("conflict.diff.empty")}</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <Table>
        <TableCaption className="sr-only">{t("conflict.diff.aria")}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("conflict.diff.field")}</TableHead>
            <TableHead>{t("conflict.diff.mine")}</TableHead>
            <TableHead>{t("conflict.diff.latest", { n: latestVersion })}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.path}>
              <TableCell className="font-mono text-label">{r.path}</TableCell>
              <Cell value={r.mine} empty={r.mineEmpty} />
              <Cell value={r.latest} empty={r.latestEmpty} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more > 0 ? (
        <p className="border-t border-border px-3 py-2 text-label text-muted-foreground">
          {t("conflict.diff.more", { n: more })}
        </p>
      ) : null}
    </div>
  );
}
