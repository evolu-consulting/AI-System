// CR-107 · eng-card-ui: banner khi lượt duyệt cần người xử lý (`attention`): lý do dễ hiểu + từ lúc nào + bước kế.
// CR-127 · Z3b-ui: route Mở lại / Thử lại / Huỷ & mở lại đã gỡ ⇒ banner chỉ báo trạng thái + lý do + ai cần làm gì (không nút chết).
import type { ApprovalAttention } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { attentionText } from "../lib/attention";

export function AttentionBanner({ attention }: { attention: ApprovalAttention }) {
  const { t } = useTranslation();
  const text = attentionText(attention);
  const at = attention.since ? new Date(attention.since) : null;
  return (
    <div
      role="alert"
      data-approval="attention"
      data-kind={attention.kind}
      className="mb-3 rounded-xl border border-rule bg-act-soft px-4 py-3 text-sm"
    >
      <p className="font-medium text-late">
        {t("contracts.approval.engine.attention.title", { reason: t(text.key, text.vars) })}
      </p>
      {at && !Number.isNaN(at.getTime()) && (
        <p className="mt-1 text-dim">
          {t("contracts.approval.engine.attention.since", {
            time: viDateTime(at.toISOString()),
          })}
        </p>
      )}
      <p data-approval="tell-owner" className="mt-2 text-dim">
        {t("contracts.approval.engine.attention.tellOwner")}
      </p>
    </div>
  );
}
