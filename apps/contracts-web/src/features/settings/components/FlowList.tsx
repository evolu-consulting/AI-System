// CR-105 L4 / CR-108 · chế độ "Danh sách" của quy trình duyệt đang dùng (đối chiếu với sơ đồ canvas): mỗi bước một dòng + thông tin hạn/nhắc/người duyệt.
import { useTranslation } from "react-i18next";
import type { CurrentFlow } from "../lib/current-flow";
import { StepInfoLines } from "./StepInfoLines";

export function FlowList({ flow }: { flow: CurrentFlow }) {
  const { t } = useTranslation();
  return (
    <ol className="mb-4 flex flex-col gap-2" data-testid="flow-diagram">
      {flow.steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2">
          <span className="text-caption text-dim">{i + 1}</span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{s.name}</span>
            <StepInfoLines
              className="!whitespace-normal"
              info={{
                dueH: s.dueH,
                remindH: s.dueH !== null ? s.remindH : null,
                approvers: s.approverCount,
                escalate: s.escalateGroup,
                escalateDefault: s.escalateDefault,
              }}
            />
          </span>
          {s.department && s.department !== s.name && (
            <span className="text-caption text-dim">{s.department}</span>
          )}
          {s.kind === "dify" && <span className="text-caption text-dim">Dify</span>}
          {s.kind === "esign" && (
            <span className="text-caption text-dim">{t("contracts.flow.current.esign")}</span>
          )}
          {s.when && s.when.conds.length > 0 && (
            <span className="ml-auto text-caption text-dim">
              {t("contracts.flow.current.conditional")}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
