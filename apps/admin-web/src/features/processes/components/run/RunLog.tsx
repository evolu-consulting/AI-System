// ADM-FR-67 · CR-056 · P-a F5: tab "Nhật ký" — lịch sử kiểm/hỏi/quyết/chuyển/huỷ của lượt chạy (không có tin nhắn phòng).
import type { HistoryItem } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatClock, type Translate } from "@/lib/format";

type Props = { history: readonly HistoryItem[]; stageNames: readonly string[] };

export const detailOf = (h: HistoryItem, t: Translate): string =>
  [
    h.kind === "branch"
      ? t("process.admin.run.log.branchDetail", { step: (h.to_step ?? 0) + 1, rule: h.rule ?? 1 })
      : undefined,
    h.feedback,
    h.question,
    h.answer,
    h.note,
  ]
    .filter((x): x is string => !!x)
    .join(" · ");

export function RunLog({ history, stageNames }: Props) {
  const t = useTranslation().t as unknown as Translate;
  const L = (k: string) => t(`process.admin.run.log.${k}`);
  if (history.length === 0) {
    return <EmptyState message={t("process.admin.run.log.empty")} />;
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <caption className="sr-only">{t("process.admin.run.tab.log")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{L("at")}</TableHead>
              <TableHead>{L("stage")}</TableHead>
              <TableHead>{L("kind")}</TableHead>
              <TableHead>{L("actor")}</TableHead>
              <TableHead>{L("detail")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lịch sử chỉ thêm cuối, không đổi chỗ
              <TableRow key={i}>
                <TableCell>{formatClock(h.at)}</TableCell>
                <TableCell>{stageNames[h.stage_idx] ?? h.stage_idx + 1}</TableCell>
                <TableCell>
                  {t(`process.admin.run.log.kinds.${h.kind}`)}
                  {h.result ? ` · ${t(`process.common.result.${h.result}`)}` : ""}
                </TableCell>
                <TableCell>{h.actor?.display_name ?? "—"}</TableCell>
                <TableCell className="max-w-md whitespace-pre-wrap break-words">
                  {detailOf(h, t) || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-caption text-muted-foreground">{t("process.admin.run.noContent")}</p>
    </div>
  );
}
