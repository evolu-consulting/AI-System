// ADM-FR-71 · P-b2 (plan-frontend FB8, §2): xử lý phím trên nút giai đoạn (canvas và StepList dùng chung).
import type { KeyboardEvent } from "react";
import type { StageOps } from "../../hooks/use-stage-ops";
import { stageKeyAction } from "../../lib/canvas-keys";

export type StageKeyCtx = {
  uid: string;
  index: number;
  step: number;
  readOnly: boolean;
  ops: StageOps;
  /** Xin xoá (mở hộp xác nhận). */
  onRemove: (uid: string) => void;
};

/** Đưa focus về nút của giai đoạn `uid` sau khi bố cục dựng lại (khoá React = uid nên thường vẫn còn). */
export function focusStage(uid: string): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-stage-uid="${uid}"]`)?.focus(),
    ),
  );
}

export function onStageKeyDown(e: KeyboardEvent, c: StageKeyCtx): void {
  const action = stageKeyAction(e);
  if (!action || action === "open") return;
  e.preventDefault();
  if (c.readOnly) return;
  if (action === "remove") {
    c.onRemove(c.uid);
    return;
  }
  if (action === "prevStep") c.ops.setStep(c.index, c.step - 1);
  else if (action === "nextStep") c.ops.setStep(c.index, c.step + 1);
  else c.ops.moveColumn(c.index, action === "up" ? -1 : 1);
  focusStage(c.uid);
}
