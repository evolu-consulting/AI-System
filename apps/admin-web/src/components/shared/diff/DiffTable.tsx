// ADM-FR-55, ADM-FR-51 · M3-R20 · M4-R12 · bảng khác biệt theo trường dùng chung (Xung đột, Nhật ký, Import; plan-frontend D5).
// Mặc định = bố cục xung đột (Trường · Bản của bạn · Bản mới nhất); `labels` đổi tiêu đề; `mode` create/delete chỉ còn một cột;
// `markChanged` thêm chữ "đã đổi" (không chỉ dựa vào màu); `unchanged` thu gọn các trường không đổi sau nút "{n} trường không đổi · Hiện".
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

export type DiffMode = "update" | "create" | "delete";
export type DiffLabels = { caption: string; field: string; before: string; after: string };
type Props = {
  rows: DiffRow[];
  more?: number;
  /** Chỉ dùng cho nhãn mặc định của ConflictDialog ("Bản mới nhất (v{n})"). */
  latestVersion?: number;
  labels?: DiffLabels;
  mode?: DiffMode;
  markChanged?: boolean;
  unchanged?: DiffRow[];
};

function Cell({ value, empty, tone }: { value: string; empty: boolean; tone?: string }) {
  const { t } = useTranslation();
  return (
    <TableCell className={cn("max-w-56 whitespace-normal break-words font-mono text-label", tone)}>
      {empty ? <span className="text-muted-foreground">{t("conflict.diff.none")}</span> : value}
    </TableCell>
  );
}

function useLabels(labels: Props["labels"], latestVersion: number | undefined): DiffLabels {
  const { t } = useTranslation();
  return (
    labels ?? {
      caption: t("conflict.diff.aria"),
      field: t("conflict.diff.field"),
      before: t("conflict.diff.mine"),
      after: t("conflict.diff.latest", { n: latestVersion ?? 0 }),
    }
  );
}

function DiffRowView(p: { row: DiffRow; mode: DiffMode; changed: boolean }) {
  const { t } = useTranslation();
  const { row, mode, changed } = p;
  return (
    <TableRow>
      <TableCell className="font-mono text-label">
        {row.path}
        {changed ? (
          <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 font-sans text-micro text-muted-foreground">
            {t("audit.diff.changed")}
          </span>
        ) : null}
      </TableCell>
      {mode === "create" ? null : (
        <Cell
          value={row.mine}
          empty={row.mineEmpty}
          tone={changed ? "bg-danger-bg line-through decoration-danger/40" : undefined}
        />
      )}
      {mode === "delete" ? null : (
        <Cell
          value={row.latest}
          empty={row.latestEmpty}
          tone={changed ? "bg-success-bg" : undefined}
        />
      )}
    </TableRow>
  );
}

export function DiffTable({
  rows,
  more = 0,
  latestVersion,
  labels,
  mode = "update",
  markChanged = false,
  unchanged = [],
}: Props) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const l = useLabels(labels, latestVersion);
  if (rows.length === 0 && unchanged.length === 0) {
    return <p className="text-body text-muted-foreground">{t("conflict.diff.empty")}</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <Table>
        <TableCaption className="sr-only">{l.caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{l.field}</TableHead>
            {mode === "create" ? null : <TableHead>{l.before}</TableHead>}
            {mode === "delete" ? null : <TableHead>{l.after}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <DiffRowView key={r.path} row={r} mode={mode} changed={markChanged} />
          ))}
          {showAll
            ? unchanged.map((r) => (
                <DiffRowView key={`u:${r.path}`} row={r} mode={mode} changed={false} />
              ))
            : null}
        </TableBody>
      </Table>
      {unchanged.length > 0 && !showAll ? (
        <div className="border-t border-border px-3 py-2">
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAll(true)}>
            {t("audit.diff.unchanged", { n: unchanged.length })}
          </Button>
        </div>
      ) : null}
      {more > 0 ? (
        <p className="border-t border-border px-3 py-2 text-label text-muted-foreground">
          {t("conflict.diff.more", { n: more })}
        </p>
      ) : null}
    </div>
  );
}
