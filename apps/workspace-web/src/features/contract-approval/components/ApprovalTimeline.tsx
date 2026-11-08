// contract-flow S4: dòng thời gian các bước duyệt của HĐ chạy trên engine — tên bước, phòng, trạng thái, hạn / quá hạn / chuyển cấp,
// người quyết + lúc, góp ý. Người có quyền sửa (platform_admin) có lối vào "Chỉnh quy trình duyệt" (sang ai-admin, CR-105 L4).
// CR-118: vẽ qua `<FlowPanel slot="contracts.approval">`; giữ nguyên khung, chữ, data-testid; lượt `machine` qua LegacyMachineRenderer.
// CR-120: FlowView ĐỌC TỪ HUB (`GET /pack/contracts/flow/contracts.approval/:id`), không dựng ở web; thẻ đổi (poll/push/sau hành
// động) ⇒ tải lại view. Runtime tắt (rollback) ⇒ view null ⇒ phép chiếu cũ trên thẻ đã tải (CR-121 xoá).
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FlowEditorLink } from "~/features/settings/components/FlowEditorLink";
import { FlowPanel, flowViewKey, useFlowView } from "~/platform/flow";
import { useGroups } from "../hooks/use-groups";
import { noRecipientSteps } from "../lib/card-status";
import { APPROVAL_SLOT, flowViewOfApproval, withGroupLabels } from "../lib/flow-view";
import { APPROVAL_OVERRIDES } from "./ApprovalSteps";
import { CanActContext } from "./StatusLines";

/** Thẻ duyệt đổi (dữ liệu mới) ⇒ tải lại FlowView của hub; lần đầu không (query đang tải). */
function useResyncView(id: string, a: ContractApproval) {
  const qc = useQueryClient();
  const seen = useRef(a);
  useEffect(() => {
    if (seen.current === a) return;
    seen.current = a;
    void qc.invalidateQueries({ queryKey: flowViewKey(APPROVAL_SLOT, id) });
  }, [a, id, qc]);
}

export function ApprovalTimeline({
  id,
  a,
  canAct = false,
  owner = false,
}: {
  id: string;
  a: ContractApproval;
  /** Người xem là người cần quyết bước đang mở (dòng "bước kế" nói "Bạn cần…"). */
  canAct?: boolean;
  /** Chủ HĐ / quản trị gói: thấy cảnh báo "bước Thông báo không có người nhận" (CR-123 U2). */
  owner?: boolean;
}) {
  const { t } = useTranslation();
  const groups = useGroups(a.mode === "engine");
  const q = useFlowView({ slot: APPROVAL_SLOT, refId: id });
  useResyncView(id, a);
  const names = groups.data ?? [];
  // Engine mà chưa có bước nào ⇒ không vẽ gì (như thẻ cũ); `machine` ⇒ FlowPanel dùng LegacyMachineRenderer.
  const full =
    (a.mode === "engine" && !a.steps?.length) || q.isPending
      ? null
      : q.data
        ? withGroupLabels(q.data, names)
        : flowViewOfApproval(a, id, names, Date.now());
  const noRecipient = owner && full ? noRecipientSteps(full.steps) : [];
  // CR-125 · UX H5 · bước hệ thống (vd "Thông báo người tạo") chỉ chủ HĐ / quản trị gói thấy; người dùng thường không phải đọc
  // "Chưa tới lượt · Chờ bước trước xong · Tới lượt sẽ báo …" của một bước không ai làm.
  const view =
    full && !owner ? { ...full, steps: full.steps.filter((s) => s.kind !== "system") } : full;
  return (
    <CanActContext.Provider value={canAct}>
      <FlowPanel
        slot={APPROVAL_SLOT}
        refId={id}
        view={view}
        overrides={APPROVAL_OVERRIDES}
        frame={(steps) => (
          <section data-approval="timeline" className="mb-4 rounded-xl border border-line p-4">
            <div className="mb-1 flex items-center gap-3">
              <h3 className="text-sm font-semibold">{t("contracts.approval.engine.title")}</h3>
              <FlowEditorLink
                testId="approval-edit-flow"
                className="ml-auto text-caption text-act underline"
              />
            </div>
            {noRecipient.map((name) => (
              <p
                key={name}
                role="alert"
                data-approval="notify-no-recipient"
                className="mb-2 rounded-lg bg-act-soft px-3 py-2 text-caption font-medium text-late"
              >
                {t("contracts.approval.notifyNoRecipient", { name })}
              </p>
            ))}
            <ol>{steps}</ol>
          </section>
        )}
      />
    </CanActContext.Provider>
  );
}
