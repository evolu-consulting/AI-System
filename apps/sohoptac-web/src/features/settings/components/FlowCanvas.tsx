// CR-106 · canvas CHỈ ĐỌC của quy trình duyệt đang dùng. CR-118 · cr118-flow-canvas: vẽ bằng gói dùng chung `@ai/flow-canvas`
// (layout `vertical`, mode `view`); file này chỉ cấp chữ (i18n), lớp CSS theo token sohoptac và dòng thông tin bước.
// Nạp qua `FlowCanvasLazy` (chunk riêng) để mục Cài đặt không kéo thư viện vào gói chính.
import {
  buildFlowCanvas,
  type CondLabels,
  type FlowLabels,
  type FlowTheme,
  FlowCanvas as SharedFlowCanvas,
  type StepInfo,
} from "@ai/flow-canvas";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CurrentStep, DealKind } from "../lib/current-flow";
import { StepInfoLines } from "./StepInfoLines";

/** Lớp CSS của node theo token của Sổ Hợp Tác (ground/panel/sunk/rule…): giữ nguyên hình như trước khi gộp gói. */
const THEME: Partial<FlowTheme> = {
  start:
    "flex items-center justify-center gap-2 rounded-full border border-rule bg-sunk text-label font-medium",
  startIcon: "size-3.5 text-dim",
  finalize:
    "flex items-center justify-center gap-2 rounded-xl border border-dashed border-field bg-sunk px-3 text-label font-medium",
  finalizeIcon: "size-4 text-dim",
  lockIcon: "size-3.5 text-dim",
  step: "flex flex-col justify-center gap-1 overflow-hidden rounded-xl border bg-panel px-3 py-2",
  stepOn: "border-rule shadow-sm",
  stepOff: "border-dashed border-rule opacity-40",
  stepIndex:
    "flex size-5 shrink-0 items-center justify-center rounded-full bg-sunk text-caption text-dim",
  stepDept: "truncate text-caption text-dim",
  pill: "rounded-full bg-act-soft px-2 py-0.5 text-caption font-semibold text-act",
};
const EDGE_LABEL = {
  fill: "var(--ink-2)",
  bgFill: "var(--card)",
  bgStroke: "var(--rule, #dcdce6)",
};
const renderInfo = (info: StepInfo) => <StepInfoLines info={info} />;

export type FlowCanvasProps = { steps: readonly CurrentStep[]; run: readonly boolean[] };

export default function FlowCanvas({ steps, run }: FlowCanvasProps) {
  const { t, i18n } = useTranslation();
  const { nodes, edges } = useMemo(() => {
    const labels: CondLabels = {
      value: t("contracts.flow.valueCond"),
      deal: t("contracts.flow.dealKind"),
      dealNames: Object.fromEntries(
        (["buy", "sell", "referral"] as const).map((d) => [d, t(`contracts.flow.deal.${d}`)]),
      ) as Record<DealKind, string>,
      and: t("contracts.flow.opAnd").toLowerCase(),
      or: t("contracts.flow.opOr").toLowerCase(),
      // vi-VN: 500.000.000 (dấu chấm ngăn nghìn) cho nhãn điều kiện trên cạnh
      number: (n) =>
        new Intl.NumberFormat(i18n.language === "vi" ? "vi-VN" : i18n.language).format(n),
      skip: t("contracts.flow.current.canvas.skip"),
      edge: EDGE_LABEL,
    };
    return buildFlowCanvas(steps, labels, run);
  }, [steps, run, t, i18n.language]);
  const labels = useMemo<Partial<FlowLabels>>(
    () => ({
      start: t("contracts.flow.current.canvas.start"),
      finalize: t("contracts.flow.current.canvas.finalize"),
      locked: t("contracts.flow.current.canvas.locked"),
      conditional: t("contracts.flow.current.conditional"),
      esign: t("contracts.flow.current.esign"),
      dify: "Dify",
    }),
    [t],
  );
  return (
    <section
      className="mb-4 h-[520px] w-full overflow-hidden rounded-xl border border-rule bg-sunk"
      data-testid="flow-canvas"
      aria-label={t("contracts.flow.current.canvas.aria")}
    >
      <SharedFlowCanvas
        layout="vertical"
        mode="view"
        nodes={nodes}
        edges={edges}
        labels={labels}
        theme={THEME}
        renderInfo={renderInfo}
      />
    </section>
  );
}
