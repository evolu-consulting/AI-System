// CR-121 D-3: đầu trang trình sửa (Loại + nguồn + phiên bản) và thanh trạng thái (Nháp / Đã xuất bản, sẵn sàng hay còn lỗi).
// Lỗi gồm kiểm phía client và lỗi xuất bản Hub trả (D-2: bước, trường, câu sửa); bấm một lỗi ⇒ nhảy tới đúng bước.
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { REMIND_MAX, REMIND_MIN } from "../../lib/flow-form";
import { statusOf } from "../../lib/library-list";
import type { LibraryDef } from "../../library-api";

export type BarIssue = { index: number | null; text: string };
type Props = {
  def: LibraryDef;
  dirty: boolean;
  issues: readonly BarIssue[];
  onJump: (index: number) => void;
};

export function FlowFormHeader({ def }: { def: LibraryDef }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, string | number>) => t(`process.admin.library.${k}`, o);
  return (
    <header className="space-y-1" data-testid="flow-form-header">
      <h2 className="text-heading font-semibold">{def.name}</h2>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
        <StatusBadge tone="info">
          {L("form.type", { slot: def.slot_label ?? def.slot ?? "" })}
        </StatusBadge>
        <span>
          {def.published_version
            ? L("form.source", { n: def.published_version })
            : L("form.sourceDraft")}
        </span>
        <span>{L("assignedCount", { n: def.tenant_count ?? 0 })}</span>
      </p>
    </header>
  );
}

export function FlowStatusBar({ def, dirty, issues, onJump }: Props) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, string | number>) => t(`process.admin.library.${k}`, o);
  const status = statusOf(def);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2"
      data-testid="flow-status-bar"
    >
      <StatusBadge
        tone={status.kind === "draft" ? "off" : status.kind === "changed" ? "warn" : "ok"}
      >
        {status.kind === "draft"
          ? L("pubState.draft")
          : status.kind === "changed"
            ? L("status.changed", { n: status.version })
            : L("pubState.published", { n: status.version })}
      </StatusBadge>
      <span className="font-mono text-caption text-muted-foreground">
        {dirty ? t("common.unsaved") : t("common.savedVersion", { n: def.version })}
      </span>
      {issues.length === 0 ? (
        <span className="text-label text-success" data-testid="flow-ready">
          {L("form.ready")}
        </span>
      ) : (
        <ul
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
          data-testid="flow-issues"
        >
          {issues.map((i) => (
            <li
              key={`${i.index}:${i.text}`}
              className="flex items-center gap-1.5 text-label text-warning"
            >
              <AlertTriangle aria-hidden className="size-4" />
              <span>{i.text}</span>
              {i.index !== null ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  data-testid={`flow-issue-jump-${i.index}`}
                  onClick={() => onJump(i.index as number)}
                >
                  {L("form.jump", { n: i.index + 1 })}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mã lỗi kiểm client → câu hiển thị (kèm số bước). */
export const issueText = (
  t: (k: string, o?: Record<string, string | number>) => string,
  index: number | null,
  code: string,
): string => {
  const msg = t(`process.admin.library.form.err.${code}`, { min: REMIND_MIN, max: REMIND_MAX });
  return index === null ? msg : t("process.admin.library.form.stepIssue", { n: index + 1, msg });
};
