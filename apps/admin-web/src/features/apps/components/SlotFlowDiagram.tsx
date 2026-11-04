// CR-118 · cr118-flow-canvas · sơ đồ CHỈ XEM của quy trình mặc định của khe (Bắt đầu → các bước → Ghi Đã duyệt, nút hệ thống khoá):
// cùng gói `@ai/flow-canvas` (layout `vertical`, mode `view`) với sơ đồ duyệt của tenant. Nạp lười (chunk `canvas-slot`) từ `SlotFlowView`.
import {
  buildVerticalGraph,
  FlowCanvas,
  type FlowLabels,
  type StepInfo,
  type VerticalStep,
} from "@ai/flow-canvas";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { StepRow, StepWho } from "../lib/flow-view";

export type SlotFlowDiagramProps = { rows: readonly StepRow[]; who: (w: StepWho) => string };

export default function SlotFlowDiagram({ rows, who }: SlotFlowDiagramProps) {
  const { t } = useTranslation();
  const { nodes, edges } = useMemo(() => {
    const steps: VerticalStep[] = rows.map((r) => ({
      key: r.key,
      name: r.name,
      department: who(r.who),
      kind: r.kind,
      dueH: r.timing?.dueH ?? null,
      remindH: r.timing?.remindH ?? null,
      escalateGroup: null,
      approverCount: null,
      condition: r.condition,
    }));
    return buildVerticalGraph(steps, t("appcfg.flow.skip"));
  }, [rows, who, t]);
  const labels = useMemo<Partial<FlowLabels>>(
    () => ({
      start: t("appcfg.flow.start"),
      finalize: t("appcfg.flow.finalize"),
      locked: t("appcfg.flow.locked"),
      conditional: t("appcfg.flow.conditional"),
      esign: t("appcfg.flow.kind.esign"),
      dify: t("appcfg.flow.kind.dify"),
    }),
    [t],
  );
  const renderInfo = useCallback(
    (info: StepInfo) =>
      info.dueH === null ? null : (
        <span className="truncate text-caption text-muted-foreground">
          {info.remindH
            ? t("appcfg.flow.timingRemind", { due: info.dueH, remind: info.remindH })
            : t("appcfg.flow.timing", { due: info.dueH })}
        </span>
      ),
    [t],
  );
  return (
    <section
      aria-label={t("appcfg.flow.diagram")}
      data-testid="slot-flow-diagram"
      className="h-[420px] w-full overflow-hidden rounded-md border border-border bg-background"
    >
      <FlowCanvas
        layout="vertical"
        mode="view"
        nodes={nodes}
        edges={edges}
        labels={labels}
        renderInfo={renderInfo}
      />
    </section>
  );
}
