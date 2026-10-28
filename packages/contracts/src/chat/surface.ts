// ADM-FR-42 · usage-analytics · bề mặt gửi tin E12 (để thống kê token theo app): web gói gửi header `X-Ai-Surface` (vd dock
// Sổ Hợp Tác = `contracts`). Vắng / giá trị lạ ⇒ null (Hub coi là chat AI System). Chỉ là nhãn thống kê — không phải quyền.
// one-agent · `chat` = AI System chat (mặc định thống kê vẫn là `chat`); cùng giá trị dùng cho `context.surface` (khối ngữ cảnh).
export const AI_SURFACE_HEADER = "X-Ai-Surface";
export const AI_SURFACES = ["contracts", "community", "chat"] as const;
export type AiSurface = (typeof AI_SURFACES)[number];
/** com-c10b · bề mặt dock (khoang trợ lý nhúng trong web gói) — hội thoại tạo qua dock mang dấu này (hub 0063). */
export const DOCK_SURFACES = ["contracts", "community"] as const;
export type DockSurface = (typeof DOCK_SURFACES)[number];

/** Giá trị header → bề mặt hợp lệ, hoặc null. */
export function surfaceOf(v: string | null | undefined): AiSurface | null {
  return (AI_SURFACES as readonly string[]).includes(v ?? "") ? (v as AiSurface) : null;
}

/** one-agent · loại bản ghi người dùng đang xem (trang chi tiết) — Hub kiểm RLS rồi mới chèn tên. */
export const CONTEXT_ENTITY_KINDS = ["contract", "partner"] as const;
export type ContextEntityKind = (typeof CONTEXT_ENTITY_KINDS)[number];
export const CONTEXT_ROUTE_MAX = 200;
export const CONTEXT_ENTITY_ID_MAX = 300;
