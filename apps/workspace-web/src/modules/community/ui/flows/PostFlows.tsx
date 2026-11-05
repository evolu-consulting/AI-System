// CR-120 · phần luồng nằm TRÊN thẻ bài: trạng thái duyệt của bài tôi (nhãn + lý do + gợi ý sửa) và hộp thoại "Báo cáo" từ menu ⋯.
import type { ModerationItem } from "@ai/contracts/community";
import { useApp } from "../../application/ctx";
import { isConflict, moderationNote } from "../../domain/flows";
import { t } from "../../i18n";
import { ReasonDialog } from "./parts";

export function ModerationNote({ item }: { item: ModerationItem }) {
  const n = moderationNote(item);
  if (!n) return null;
  return (
    <div className="callout hint" data-testid="mod-note" data-state={item.moderation}>
      <span className="ct">
        <span className={`tag ${n.tone} sm`} data-testid="mod-label">
          {t(n.labelKey, n.params)}
        </span>{" "}
        {t(n.whyKey)}
        {n.hintKey && (
          <>
            {" "}
            <i data-testid="mod-hint">{t(n.hintKey)}</i>
          </>
        )}
      </span>
    </div>
  );
}

export function ReportDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { api, toast } = useApp();
  return (
    <ReasonDialog
      testId="report-dialog"
      title={t("community.flows.reports.dialogTitle")}
      intro={t("community.flows.reports.dialogIntro")}
      label={t("community.flows.reports.reasonLabel")}
      required
      submitLabel={t("community.flows.reports.send")}
      onClose={onClose}
      onSubmit={async (reason) => {
        try {
          await api.flows.reportPost(postId, reason);
          toast(t("community.flows.reports.sent"));
          onClose();
        } catch (e) {
          if (!isConflict(e)) throw e;
          toast(t("community.flows.reports.duplicate"));
          onClose();
        }
      }}
    />
  );
}
