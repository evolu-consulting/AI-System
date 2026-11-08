// CR-125 · c1 · MỘT định nghĩa "người ký đã ký" cho mọi nơi (nhắc ký `esign-sweep.rules`, đổi cách ký `esign-switch`, đầu ra node
// `esign-outputs.rules`): có mốc `signed_at` HOẶC trạng thái người ký `completed`/`signed` (DocuSign) — không phân biệt hoa thường.
// Thuần, lớp 1.
export type SignerState = { signed_at?: string | null; status?: string | null };

export const isSigned = (s: SignerState): boolean =>
  s.signed_at != null || ["completed", "signed"].includes((s.status ?? "").toLowerCase());
