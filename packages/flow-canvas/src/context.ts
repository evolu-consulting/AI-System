// CR-118 · @ai/flow-canvas · ngữ cảnh host cho node/cạnh: chữ, lớp CSS, chế độ, móc "thêm giai đoạn", bước đang bị chặn khi kéo.
import { createContext, type ReactNode, useContext } from "react";
import type { FlowMode } from "./mode";
import {
  DEFAULT_LABELS,
  DEFAULT_THEME,
  type FlowLabels,
  type FlowTheme,
  type RenderStepInfo,
} from "./theme";

export type FlowHost = {
  theme: FlowTheme;
  labels: FlowLabels;
  mode: FlowMode;
  renderInfo: RenderStepInfo | undefined;
  /** Nút "＋ Thêm giai đoạn vào bước n" ở tiêu đề cột (chỉ `edit`). */
  onAddToStep: ((step: number) => void) | undefined;
  /** Bước (0-based) của cột đầy đang bị rê vào, hoặc `null`. */
  blockedStep: number | null;
  /** CR-122 · P8: nút "+" giữa cạnh (chèn bước vào giữa) — host dựng nội dung; vắng ⇒ không hiện. */
  renderEdgeInsert: ((e: EdgeInsertInfo) => ReactNode) | undefined;
};

export type EdgeInsertInfo = { source: string; target: string; side?: "yes" | "no" };

export const DEFAULT_HOST: FlowHost = {
  theme: DEFAULT_THEME,
  labels: DEFAULT_LABELS,
  mode: "view",
  renderInfo: undefined,
  onAddToStep: undefined,
  blockedStep: null,
  renderEdgeInsert: undefined,
};

export const FlowHostCtx = createContext<FlowHost>(DEFAULT_HOST);
export const useFlowHost = (): FlowHost => useContext(FlowHostCtx);
