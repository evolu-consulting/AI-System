// CR-127 · P1 · BR-60…65 · spec §2.4, §3 #12–#14c: phiên ký chung liên công ty — luật thuần (lớp 1). Trạng thái phiên (hub) ⇒ chuyển HĐ của
// MỖI bên qua cổng (`contract-state.rules`) + tín hiệu `sign.session.*` cho node chờ (P2 nối `signals`). Hai bên cùng một luật (tất cả-hoặc-không):
// cả hai ký ⇒ done · một bên từ chối ⇒ reject · huỷ phiên ⇒ draft (bên nhận: "chờ bản sửa") · quá hạn ký ⇒ chờ bên gửi chọn Gửi lại (draft) /
// Dừng (reject) · hết hạn trả lời / bên nhận chọn xử lý bình thường ⇒ không đổi HĐ (luồng thường chạy tiếp).
import type { ContractEv } from "./contract-state.rules";

export const SIGN_SESSION_STATUSES = [
  "accepted",
  "signing",
  "done",
  "cancelled",
  "declined",
  "expired",
  "fallback",
] as const;
export type SignSessionStatus = (typeof SIGN_SESSION_STATUSES)[number];
export type ExpireChoice = "resend" | "stop";

export type SignSessionPlan = {
  /** Chuyển HĐ (CAS từ processing); null = không đổi trạng thái HĐ. */
  ev: ContractEv | null;
  /** Tín hiệu cho node chờ của lượt gắn HĐ; null = không bắn. */
  signal: string | null;
  data: Readonly<Record<string, string | number>>;
};

const plan = (
  ev: ContractEv | null,
  signal: string | null,
  data: Record<string, string | number> = {},
): SignSessionPlan => ({ ev, signal, data });

/** Trạng thái phiên (+ lựa chọn khi quá hạn ký) ⇒ việc phía một bên. Hai bên cùng kết quả (spec §3 #12–#14c). */
export function signSessionPlan(
  status: SignSessionStatus,
  choice: ExpireChoice | null,
): SignSessionPlan {
  switch (status) {
    case "accepted":
      return plan(null, "sign.session.accepted");
    case "signing":
      return plan(null, "sign.session.signed");
    case "done":
      return plan("sign_session_done", "sign.session.done");
    case "declined":
      return plan("sign_session_declined", "sign.session.declined");
    case "cancelled":
      return plan("sign_session_cancelled", "sign.session.cancelled");
    case "expired":
      if (choice === "resend")
        return plan("sign_session_expired_resend", "sign.session.cancelled", { reason: "expired" });
      if (choice === "stop")
        return plan("sign_session_expired_stop", "sign.session.declined", { reason: "expired" });
      return plan(null, "sign.session.expired", { stage: "sign" });
    case "fallback":
      return plan(null, "sign.session.expired", { stage: "accept" });
  }
}

export const SIGN_SESSION_ERRORS = [
  "SESSION_NOT_ACTIVE",
  "SESSION_FORBIDDEN",
  "SESSION_HASH_MISMATCH",
] as const;
export type SignSessionError = (typeof SIGN_SESSION_ERRORS)[number];

/** Lỗi do hàm `hub.sign_session_*` RAISE (message = mã) ⇒ mã nghiệp vụ; khác ⇒ null (người gọi ném tiếp). */
export function signSessionErrorOf(e: unknown): SignSessionError | null {
  const msg =
    e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : "";
  return SIGN_SESSION_ERRORS.find((c) => msg.includes(c)) ?? null;
}

export const SIGN_SESSION_HTTP: Readonly<Record<SignSessionError, number>> = {
  SESSION_NOT_ACTIVE: 409,
  SESSION_FORBIDDEN: 403,
  SESSION_HASH_MISMATCH: 422,
};
