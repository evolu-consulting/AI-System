// ADM-FR-42 · usage-analytics · bề mặt gửi tin E12 (để thống kê token theo app): web gói gửi header `X-Ai-Surface` (vd dock
// Sổ Hợp Tác = `contracts`). Vắng / giá trị lạ ⇒ null (Hub coi là chat AI System). Chỉ là nhãn thống kê — không phải quyền.
export const AI_SURFACE_HEADER = "X-Ai-Surface";
export const AI_SURFACES = ["contracts"] as const;
export type AiSurface = (typeof AI_SURFACES)[number];

/** Giá trị header → bề mặt hợp lệ, hoặc null. */
export function surfaceOf(v: string | null | undefined): AiSurface | null {
  return (AI_SURFACES as readonly string[]).includes(v ?? "") ? (v as AiSurface) : null;
}
