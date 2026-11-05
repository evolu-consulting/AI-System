// CR-120 G1 · renderer bước `agent` (executor agent/team): khung bước chung + tóm tắt kết quả agent (text thuần, server đã lọc).
import { useTranslation } from "react-i18next";
import { StepFrame } from "./StepRow";
import type { StepProps } from "./types";

export default function AgentStep({ step, ctx }: StepProps<"agent">) {
  const { t } = useTranslation();
  return (
    <StepFrame step={step} now={ctx.now}>
      {step.agent.summary && (
        <p data-testid={`flow-agent-${step.key}`} className="mt-1 text-caption text-dim">
          {t("contracts.flowPanel.agentResult")}: {step.agent.summary}
        </p>
      )}
    </StepFrame>
  );
}
