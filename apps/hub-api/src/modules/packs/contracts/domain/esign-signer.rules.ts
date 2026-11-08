// CR-125 · c1 · MỘT định nghĩa "người ký đã ký" cho mọi nơi (nhắc ký `esign-sweep.rules`, đổi cách ký `esign-switch`, đầu ra node
// `esign-outputs.rules`): có mốc `signed_at` HOẶC trạng thái người ký `completed`/`signed` (DocuSign) — không phân biệt hoa thường.
// Thuần, lớp 1.
export type SignerState = { signed_at?: string | null; status?: string | null };

export const isSigned = (s: SignerState): boolean =>
  s.signed_at != null || ["completed", "signed"].includes((s.status ?? "").toLowerCase());

/** CR-125 · đến lượt `m`: chưa ký và mọi người có `order` nhỏ hơn đã ký (cùng `order` ⇒ ký song song). Nhắc ký + "Ký ngay" dùng chung. */
export const isTurnOf = (
  signers: readonly (SignerState & { order: number })[],
  m: SignerState & { order: number },
): boolean => !isSigned(m) && signers.every((p) => p.order >= m.order || isSigned(p));
