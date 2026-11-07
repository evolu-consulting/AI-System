// ADM-FR-71 · P-b2 (plan-frontend §6): ngữ cảnh canvas — tay cầm sự kiện ổn định (qua ref) để node `memo` không dựng lại
// mỗi lần cha render. (Bước đang bị chặn khi kéo nay do @ai/flow-canvas giữ: prop `blockedStep`.)
import type { LayoutDir } from "@ai/contracts/hub-admin";
import { Position } from "@xyflow/react";
import { createContext, useContext } from "react";
import type { StageOps } from "../../hooks/use-stage-ops";

export type CanvasHandlers = {
  readOnly: boolean;
  ops: StageOps;
  onSelect: (uid: string, byKeyboard: boolean) => void;
  onRemove: (uid: string) => void;
};

export const HandlersCtx = createContext<{ current: CanvasHandlers } | null>(null);

export function useHandlers(): CanvasHandlers {
  const ref = useContext(HandlersCtx);
  if (!ref) throw new Error("useHandlers ngoài ProcessCanvas");
  return ref.current;
}

/** CR-125 · x9 · hướng bố cục đang dùng — node đọc để đặt cổng vào/ra đúng mép (Ngang: vào trái, ra phải; Dọc: vào trên, ra dưới). */
export const DirCtx = createContext<LayoutDir>("RIGHT");
export const useDir = (): LayoutDir => useContext(DirCtx);

export type Sides = {
  /** Cổng vào (đích của cạnh tiến). */
  in: Position;
  /** Cổng ra "đi tiếp" / các đầu ra theo kết quả. */
  out: Position;
  /** Nguồn cạnh quay lại / đích của cạnh quay lại (ẩn). */
  back: Position;
  backIn: Position;
  /** Nguồn cạnh rẽ nhánh (ẩn). */
  branch: Position;
};

/** Mép đặt từng loại cổng theo hướng. */
export const sidesOf = (dir: LayoutDir): Sides =>
  dir === "DOWN"
    ? {
        in: Position.Top,
        out: Position.Bottom,
        back: Position.Left,
        backIn: Position.Right,
        branch: Position.Right,
      }
    : {
        in: Position.Left,
        out: Position.Right,
        back: Position.Top,
        backIn: Position.Bottom,
        branch: Position.Bottom,
      };

/** Vị trí chấm / nhãn dọc theo mép có cổng: Ngang ⇒ `top`, Dọc ⇒ `left` (cùng phần trăm). */
export const alongEdge = (dir: LayoutDir, pct: string): { top: string } | { left: string } =>
  dir === "DOWN" ? { left: pct } : { top: pct };
