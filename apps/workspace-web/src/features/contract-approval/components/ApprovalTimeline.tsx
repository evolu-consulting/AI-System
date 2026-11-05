// contract-flow S4: dòng thời gian các bước duyệt của HĐ chạy trên engine — tên bước, phòng, trạng thái, hạn / quá hạn / chuyển cấp,
// người quyết + lúc, góp ý. Người có quyền sửa (platform_admin) có lối vào "Chỉnh quy trình duyệt" (sang ai-admin, CR-105 L4).
// CR-118 (cr118-flow-web): vẽ qua `<FlowPanel slot="contracts.approval">` (nguồn = thẻ duyệt đã tải, không thêm yêu cầu mạng); giữ
// nguyên khung, chữ, data-testid; lượt `machine` đi qua LegacyMachineRenderer (không dòng bước, như trước).
import type { ContractApproval } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { FlowEditorLink } from "~/features/settings/components/FlowEditorLink";
import { FlowPanel } from "~/platform/flow";
import { useGroups } from "../hooks/use-groups";
import { APPROVAL_SLOT, flowViewOfApproval } from "../lib/flow-view";
import { APPROVAL_OVERRIDES } from "./ApprovalSteps";

export function ApprovalTimeline({ id, a }: { id: string; a: ContractApproval }) {
  const { t } = useTranslation();
  const groups = useGroups(a.mode === "engine");
  // Engine mà chưa có bước nào ⇒ không vẽ gì (như thẻ cũ); `machine` ⇒ FlowPanel dùng LegacyMachineRenderer.
  const view =
    a.mode === "engine" && !a.steps?.length
      ? null
      : flowViewOfApproval(a, id, groups.data ?? [], Date.now());
  return (
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
          <ol>{steps}</ol>
        </section>
      )}
    />
  );
}
