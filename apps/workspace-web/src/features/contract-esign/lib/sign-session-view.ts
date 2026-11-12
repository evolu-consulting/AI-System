// CR-127 · U6 · M2d · spec §2.4 BR-60…65: phiên ký cùng lúc giữa hai công ty — hai bên thấy GIỐNG NHAU (tên công ty + người ký, không lộ người duyệt nội bộ). Thuần.
export type SessionStatus =
  | "proposed"
  | "accepted"
  | "signing"
  | "done"
  | "cancelled"
  | "declined"
  | "expired"
  | "fallback";

export type SignSession = {
  side: "from" | "to";
  status: SessionStatus;
  expire_choice: "resend" | "stop" | null;
  reason: string | null;
  accept_deadline_at: string;
  sign_deadline_at: string | null;
  from_company: string | null;
  from_signer_name: string | null;
  from_signed_at: string | null;
  to_company: string | null;
  to_signer_name: string | null;
  to_signed_at: string | null;
  cancel_side: "from" | "to" | null;
  cancel_reason: string | null;
};

export type SignRow = { company: string | null; signer: string | null; signedAt: string | null };
export type SessionView = {
  /** Khoá i18n `contracts.u6.cosign.phase.<phase>`. */
  phase: SessionStatus;
  /** Bên nhận chưa trả lời: hiện Đồng ý / Xử lý bình thường / Từ chối. */
  canRespond: boolean;
  /** Đang ký chung (đã đồng ý) hoặc bên gửi chưa được trả lời: hiện «Huỷ phiên ký» (cần lý do). */
  canCancel: boolean;
  rows: [SignRow, SignRow] | null;
  /** Hạn đang chạy: trả lời (proposed) hoặc ký (signing). */
  deadline: string | null;
};

export function sessionView(s: SignSession, write: boolean): SessionView {
  const live = s.status === "accepted" || s.status === "signing";
  return {
    phase: s.status,
    canRespond: write && s.side === "to" && s.status === "proposed",
    canCancel: write && (live || (s.status === "proposed" && s.side === "from")),
    rows:
      live || s.status === "done"
        ? [
            { company: s.from_company, signer: s.from_signer_name, signedAt: s.from_signed_at },
            { company: s.to_company, signer: s.to_signer_name, signedAt: s.to_signed_at },
          ]
        : null,
    deadline: s.status === "proposed" ? s.accept_deadline_at : live ? s.sign_deadline_at : null,
  };
}

/** Phiên kết thúc do huỷ/từ chối: lý do (nếu có). */
export const endedReason = (s: SignSession): string | null =>
  s.status === "cancelled" || s.status === "declined" ? (s.cancel_reason ?? s.reason) : null;
