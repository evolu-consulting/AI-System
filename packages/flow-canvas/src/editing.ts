// CR-123 · p25 · @ai/flow-canvas · phần THUẦN của sửa tay trên canvas (kéo từ bảng mẫu, nối lại, chọn nhiều, phím tắt, minimap).
// Tất cả là opt-in qua `FlowCanvasProps.editing` — vắng ⇒ canvas y như trước (workspace-web không đổi).
import type { Connection, XYPosition } from "@xyflow/react";

/** Kiểu dữ liệu kéo từ bảng mẫu (chuỗi JSON do host đặt vào `dataTransfer`). */
export const FLOW_PALETTE_MIME = "application/x-flow-palette";

export type FlowCommand = "delete" | "copy" | "paste" | "undo" | "redo";
export type FlowSelection = { nodes: string[]; edges: string[] };
export type PaletteDrop = {
  /** Chuỗi host đã đặt khi bắt đầu kéo. */
  data: string;
  /** Toạ độ thả trong hệ toạ độ sơ đồ. */
  position: XYPosition;
  /** Cạnh dưới con trỏ lúc thả (chèn giữa), hoặc `null` (thả lên vùng trống). */
  edgeId: string | null;
};
export type ReconnectTo = { source: string; target: string; sourceHandle?: string | null };

export type FlowEditing = {
  /** Chọn nhiều node (Shift+nhấn, Shift+kéo khung) và chọn cạnh. */
  selectable?: boolean;
  /** Kiểm sơ bộ khi rê dây nối (luật do host; báo lý do ở `onConnect`/`onReconnect`). */
  isValidConnection?: (c: Connection) => boolean;
  /** Kéo đầu ĐÍCH của một cạnh sang node khác (cạnh cần `reconnectable: "target"`). */
  onReconnect?: (edgeId: string, to: ReconnectTo) => void;
  /** Delete/Backspace, Ctrl+C/V, Ctrl+Z/Y khi canvas đang giữ focus. */
  onCommand?: (cmd: FlowCommand, sel: FlowSelection) => void;
  /** Thả một mục từ bảng mẫu lên canvas. */
  onPaletteDrop?: (d: PaletteDrop) => void;
  /** Bản đồ thu nhỏ góc dưới phải. */
  miniMap?: boolean;
};

export type KeyEv = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** Phím → lệnh sửa (hoặc `null`). Ctrl+Shift+Z và Ctrl+Y đều là làm lại. */
export function commandOfKey(e: KeyEv): FlowCommand | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return !e.shiftKey && (e.key === "Delete" || e.key === "Backspace") ? "delete" : null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (e.shiftKey) return null;
  if (k === "y") return "redo";
  if (k === "c") return "copy";
  if (k === "v") return "paste";
  return null;
}
