// CR-118 · @ai/flow-canvas · cửa công khai NẶNG (React + xyflow): CHỈ nạp lười (`import()`), không import tĩnh ở gói chính.
// Phần thuần (bố cục, registry, kiểu) có ở `@ai/flow-canvas/pure`.

export { type EdgeInsertInfo, type FlowHost, FlowHostCtx, useFlowHost } from "./context";
export { toEdge } from "./edges/toEdge";
export { FlowCanvas, type FlowCanvasProps } from "./FlowCanvas";
export { HiddenHandle } from "./nodes/HiddenHandle";
export * from "./pure";
export {
  DEFAULT_LABELS,
  DEFAULT_THEME,
  type FlowLabels,
  type FlowTheme,
  type RenderStepInfo,
} from "./theme";
export { type FlowPositions, useFlowLayout } from "./use-flow-layout";
export { FIT, FIT_COMPACT } from "./view-fit";
