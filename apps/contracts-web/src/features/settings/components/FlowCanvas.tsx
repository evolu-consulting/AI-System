// CR-106 · canvas CHỈ ĐỌC của quy trình duyệt đang dùng (@xyflow/react, cùng phiên bản admin-web).
// Nạp qua `FlowCanvasLazy` (chunk riêng) để mục Cài đặt không kéo thư viện vào gói chính.
import "@xyflow/react/dist/base.css";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CurrentStep, DealKind } from "../lib/current-flow";
import { buildFlowCanvas, type CondLabels } from "../lib/flow-canvas";
import { FLOW_NODE_TYPES } from "./FlowCanvasNode";

const EDGE_DEFAULTS = {
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 1.5 },
};
const FIT = { padding: 0.15, maxZoom: 1 };

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
      number: (n) => new Intl.NumberFormat(i18n.language).format(n),
    };
    return buildFlowCanvas(steps, labels, run);
  }, [steps, run, t, i18n.language]);
  return (
    <section
      className="mb-4 h-[420px] w-full overflow-hidden rounded-xl border border-rule bg-sunk"
      data-testid="flow-canvas"
      aria-label={t("contracts.flow.current.canvas.aria")}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={FLOW_NODE_TYPES}
        defaultEdgeOptions={EDGE_DEFAULTS}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={FIT}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
