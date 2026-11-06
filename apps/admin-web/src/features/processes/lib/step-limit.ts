// CR-121 c17b · bộ đếm "n/20", chặn bước thứ 21 và nhãn phiên bản xuất bản kế tiếp của trình sửa quy trình. Logic thuần.
import { FLOW_MAX_STEPS } from "./flow-form";

export const stepCounter = (n: number, max = FLOW_MAX_STEPS): string => `${n}/${max}`;
export const canAddStep = (n: number, max = FLOW_MAX_STEPS): boolean => n < max;

/** Bản xuất bản kế tiếp: chưa xuất bản ⇒ v1; đã xuất bản vN ⇒ vN+1. */
export const nextVersion = (published: number | null | undefined): number => (published ?? 0) + 1;

/** Chế độ chỉnh của thư viện (canvas | form) ↔ chế độ xem dùng chung (canvas | list): "Danh sách" = Form. */
export const editorModeOf = (v: "canvas" | "list"): "canvas" | "form" =>
  v === "list" ? "form" : "canvas";
export const viewModeOf = (m: "canvas" | "form"): "canvas" | "list" =>
  m === "form" ? "list" : "canvas";
