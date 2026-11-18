// CR-106 · CR-184 · sơ đồ CHỈ XEM của quy trình đang chạy: CÙNG đồ thị với trang quản trị (Bắt đầu → bước → Nếu Đúng/Sai → Gửi đối tác → Kết thúc),
// dựng bằng gói dùng chung `@ai/flow-canvas` (`buildDefViewGraph` + ELK hướng Dọc, mode `view`); file này chỉ cấp chữ (i18n) + lớp CSS theo token sohoptac.
// Nạp qua `FlowCanvasLazy` (chunk riêng) để mục Cài đặt không kéo thư viện vào gói chính.
import {
  type FlowLabels,
  type FlowTheme,
  FlowCanvas as SharedFlowCanvas,
  useFlowLayout,
} from "@ai/flow-canvas";
import { buildDefViewGraph } from "@ai/flow-canvas/pure";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CurrentFlow } from "../lib/current-flow";
import { flowBox } from "../lib/flow-box";
import { viewStages, viewTrigger } from "../lib/flow-view";

/** Lớp CSS của node theo token của Sổ Hợp Tác (ground/panel/sunk/rule…). */
const THEME: Partial<FlowTheme> = {
  startIcon: "size-3.5 text-act",
  finalize:
    "flex items-center justify-center gap-2 rounded-xl border border-dashed border-field bg-sunk px-3 text-label font-medium",
  finalizeIcon: "size-4 shrink-0 text-ok",
  step: "flex flex-col justify-center gap-1 overflow-hidden rounded-xl border bg-panel px-3 py-2",
  stepOn: "border-rule shadow-sm",
  stepIndex:
    "flex size-5 shrink-0 items-center justify-center rounded-full bg-sunk text-caption text-dim",
  stepDept: "truncate text-caption text-dim",
  pill: "rounded-full bg-act-soft px-2 py-0.5 text-caption font-semibold text-act",
  trigger:
    "flex flex-col justify-center gap-1 overflow-hidden rounded-xl border-2 border-act bg-panel px-3 text-label",
  ifShape: "fill-panel stroke-rule",
  stepWarn: "border-warning",
  stepPick: "ring-2 ring-act",
  roleLine: "truncate text-caption text-dim",
  warnLine: "truncate text-caption font-semibold text-warning",
};
const narrow = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

/** CR-182 · `onPick` (chỉ quản trị công ty): bấm bước có vai ⇒ mở khung giao việc; `selectedId` = bước đang mở. */
export type FlowCanvasProps = {
  flow: CurrentFlow;
  selectedId?: string | null;
  onPick?: (stageKey: string) => void;
};

export default function FlowCanvas({ flow, selectedId, onPick }: FlowCanvasProps) {
  const { t, i18n } = useTranslation();
  const stages = useMemo(() => viewStages(flow, t), [flow, t]);
  const trigger = useMemo(() => viewTrigger(flow, t), [flow, t]);
  const struct = useMemo(
    () => buildDefViewGraph(stages, trigger, null, null, i18n.language).layout,
    [stages, trigger, i18n.language],
  );
  const auto = useFlowLayout(struct.nodes, struct.edges, {
    direction: "DOWN",
    aspectRatio: narrow() ? 0.8 : 1.8,
  });
  const { nodes, edges } = useMemo(
    () => buildDefViewGraph(stages, trigger, auto, selectedId, i18n.language),
    [stages, trigger, auto, selectedId, i18n.language],
  );
  const labels = useMemo<Partial<FlowLabels>>(
    () => ({
      yes: t("contracts.flow.current.canvas.yes"),
      no: t("contracts.flow.current.canvas.no"),
      edgeBranch: (n) => t("contracts.flow.current.canvas.branch", { n }),
      canvas: t("contracts.flow.current.canvas.aria"),
    }),
    [t],
  );
  // chữ thẻ bước ≥ 12px: khung canvas đủ lớn để fit ở zoom 1; sơ đồ dài hơn khung nhìn ⇒ cuộn trong vùng bao (không thu nhỏ chữ)
  const box = useMemo(() => flowBox(nodes), [nodes]);
  return (
    <section
      className="mb-4 max-h-[520px] w-full overflow-auto rounded-xl border border-rule bg-sunk"
      data-testid="flow-canvas"
      aria-label={t("contracts.flow.current.canvas.aria")}
    >
      <div
        className="w-full"
        style={{ minWidth: box.width || undefined, height: Math.max(box.height, 320) }}
      >
        <SharedFlowCanvas
          layout="flow"
          mode="view"
          nodes={nodes}
          edges={edges}
          labels={labels}
          theme={THEME}
          onNodeClick={
            onPick && ((n) => stages.some((s) => s.uid === n.id && s.role) && onPick(n.id))
          }
          fitSig={nodes.map((n) => n.id).join(",")}
          fitMin={0.3}
        />
      </div>
    </section>
  );
}
