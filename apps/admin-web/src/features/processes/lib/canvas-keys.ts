// HUB-FR-104 · P-b2 (plan-frontend FB8): phím tắt trên node/dòng stage — MỘT chỗ đổi tổ hợp (Alt → Shift+Alt nếu UAT vướng).
export type StageKeyAction = "prevStep" | "nextStep" | "up" | "down" | "open" | "remove";
export type KeyLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

/** Tổ hợp phụ cho thao tác di chuyển: hiện là Alt (không Ctrl/Meta/Shift). */
const isMoveChord = (e: KeyLike): boolean => e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
const MOVES: Record<string, StageKeyAction> = {
  ArrowLeft: "prevStep",
  ArrowRight: "nextStep",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** Phím → thao tác (hoặc `null` ⇒ để trình duyệt/xyflow xử lý). Gọi `preventDefault` khi khác `null`. */
export function stageKeyAction(e: KeyLike): StageKeyAction | null {
  if (isMoveChord(e)) return MOVES[e.key] ?? null;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === "Enter") return "open";
  if (e.key === "Delete") return "remove";
  return null;
}
