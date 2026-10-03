// ADM-FR-51 · một dòng nhật ký: giờ · avatar chữ · câu mô tả · badge loại · chip version · nút "Xem thay đổi".
import type { AuditItem } from "@ai/contracts";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auditSentence, entityKey } from "@/lib/audit-sentence";
import { formatClock } from "@/lib/format";
import { useTr } from "@/lib/use-translate";
import type { AuditSearch } from "../lib/search";

type Props = { item: AuditItem; search: AuditSearch };

export const AuditRow = memo(function AuditRow({ item, search }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const navigate = useNavigate();
  const sentence = auditSentence(item, tr);
  const initial = (item.actor_username ?? "·").slice(0, 1).toUpperCase();
  return (
    <li className="flex items-center gap-3 border-b border-border px-3 py-2.5 [content-visibility:auto]">
      <time dateTime={item.at} className="w-12 shrink-0 font-mono text-label text-muted-foreground">
        {formatClock(item.at)}
      </time>
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-caption font-semibold text-muted-foreground"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate text-body">{sentence}</span>
      <Badge variant="outline">{t(`audit.entityLabel.${entityKey(item.entity)}`)}</Badge>
      {item.entity_version !== null ? (
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
          v{item.entity_version}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          void navigate({ to: "/audit/$auditId", params: { auditId: item.id }, search })
        }
      >
        {t("audit.viewChanges")}
      </Button>
    </li>
  );
});
