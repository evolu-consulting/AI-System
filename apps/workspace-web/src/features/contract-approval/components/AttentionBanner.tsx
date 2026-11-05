// CR-107 · eng-card-ui: banner khi lượt engine cần người xử lý (`attention`): lý do dễ hiểu + từ lúc nào; owner/admin gói có
// Thử lại / Huỷ & mở lại (hộp xác nhận) hoặc Mở lại quy trình; người khác chỉ thấy "báo chủ hợp đồng".
import type { ApprovalAttention } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { attentionActions, attentionText } from "../lib/attention";

type Props = {
  attention: ApprovalAttention;
  owner: boolean;
  busy: boolean;
  onRetry: () => void;
  onCancelReopen: () => void;
  onReopen: () => void;
};

export function AttentionBanner({
  attention,
  owner,
  busy,
  onRetry,
  onCancelReopen,
  onReopen,
}: Props) {
  const { t, i18n } = useTranslation();
  const text = attentionText(attention);
  const can = attentionActions(attention, owner);
  const at = attention.since ? new Date(attention.since) : null;
  const confirmCancel = async () => {
    const ok = await confirmDialog({
      title: t("contracts.approval.engine.attention.confirmTitle"),
      body: t("contracts.approval.engine.attention.confirmBody"),
      confirmLabel: t("contracts.approval.engine.attention.cancelReopen"),
      danger: true,
    });
    if (ok) onCancelReopen();
  };
  return (
    <div
      role="alert"
      data-approval="attention"
      data-kind={attention.kind}
      className="mb-3 rounded-xl border border-line bg-act-soft px-4 py-3 text-sm"
    >
      <p className="font-medium text-late">
        {t("contracts.approval.engine.attention.title", { reason: t(text.key, text.vars) })}
      </p>
      {at && !Number.isNaN(at.getTime()) && (
        <p className="mt-1 text-muted">
          {t("contracts.approval.engine.attention.since", {
            time: at.toLocaleString(i18n.language),
          })}
        </p>
      )}
      {can.tellOwner && (
        <p data-approval="tell-owner" className="mt-2 text-muted">
          {t("contracts.approval.engine.attention.tellOwner")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {can.retry && (
          <button
            type="button"
            data-approval="retry"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onRetry}
          >
            {t("contracts.approval.engine.attention.retry")}
          </button>
        )}
        {can.cancelReopen && (
          <button
            type="button"
            data-approval="cancel-reopen"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => void confirmCancel()}
          >
            {t("contracts.approval.engine.attention.cancelReopen")}
          </button>
        )}
        {can.reopen && (
          <button
            type="button"
            data-approval="reopen"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onReopen}
          >
            {t("contracts.approval.engine.reopen")}
          </button>
        )}
      </div>
    </div>
  );
}
