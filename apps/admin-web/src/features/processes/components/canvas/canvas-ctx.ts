// ADM-FR-71 · P-b2 (plan-frontend §6): ngữ cảnh canvas — tay cầm sự kiện ổn định (qua ref) để node `memo` không dựng lại
// mỗi lần cha render; và bước đang bị chặn khi kéo (cột đầy) để tô header mà không đổi mảng `nodes` giữa lúc kéo.
import { createContext, useContext } from "react";
import type { StageOps } from "../../hooks/use-stage-ops";

export type CanvasHandlers = {
  readOnly: boolean;
  ops: StageOps;
  onSelect: (uid: string, byKeyboard: boolean) => void;
  onRemove: (uid: string) => void;
};

export const HandlersCtx = createContext<{ current: CanvasHandlers } | null>(null);
/** Bước (0-based) của cột đầy đang bị rê vào, hoặc `null`. */
export const BlockedStepCtx = createContext<number | null>(null);

export function useHandlers(): CanvasHandlers {
  const ref = useContext(HandlersCtx);
  if (!ref) throw new Error("useHandlers ngoài ProcessCanvas");
  return ref.current;
}
export const useBlockedStep = (): number | null => useContext(BlockedStepCtx);
