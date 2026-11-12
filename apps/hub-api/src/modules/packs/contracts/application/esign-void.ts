// esign-flow-fix · huỷ phong bì đang mở vì mở lại HĐ (K4). Huỷ ở nhà cung cấp OK ⇒ ghi `voided` (bản đã ký cũ giữ lịch sử); hụt / nhà
// cung cấp không khả dụng ⇒ GIỮ trạng thái mở, `reason = VOID_PENDING` + log — làm mới/webhook (`sync`) thử huỷ lại. Lớp 2.
import type { EnvelopeRow, ESignProvider, ESignRepo } from "./esign.ports";

export const REOPENED = "contract-reopened";
/** `reason` của phong bì còn mở mà lần huỷ (mở lại HĐ) hụt ở nhà cung cấp. */
export const VOID_PENDING = "void-pending:contract-reopened";
export const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

type Run = <T>(fn: (r: { esign: ESignRepo }) => Promise<T>) => Promise<T>;
type Warn = ((msg: string, meta: Record<string, unknown>) => void) | undefined;

/** `reason` của phong bì node Ký số bị huỷ vì quá hạn (E5c). */
export const EXPIRED = "esign-expired";

/** CR-122 · E5c · huỷ phong bì QUÁ HẠN: huỷ ở nhà cung cấp OK ⇒ `voided` (reason `esign-expired`); hụt ⇒ giữ nguyên, trả false (vòng quét thử lại). */
export function voidForExpiry(warn: Warn) {
  return async (p: ESignProvider | null, e: EnvelopeRow, run: Run): Promise<boolean> => {
    const fail = (err: unknown) => {
      warn?.("esign-expire-failed", { envelope: e.id, error: errName(err) });
      return false;
    };
    const ok = p ? await p.voidEnvelope(e.envelopeId, EXPIRED).then(() => true, fail) : false;
    if (ok)
      await run((r) =>
        r.esign.update(e.envelopeId, {
          status: "voided",
          reason: EXPIRED,
          completedAt: null,
          signers: e.signers,
        }),
      );
    return ok;
  };
}

/** `reason` của phong bì huỷ vì phiên ký chung kết thúc không ký (huỷ / từ chối / quá hạn) — CR-127 · P2b. */
export const SESSION_ENDED = "sign-session-ended";

/**
 * CR-127 · P2b · spec §2.4: phiên ký chung kết thúc không ký ⇒ huỷ phong bì CÒN MỞ của HĐ bên mình. Huỷ ở nhà cung cấp OK ⇒ `voided`
 * (reason `sign-session-ended`); hụt / không khả dụng ⇒ giữ mở + `VOID_PENDING` (làm mới/webhook thử huỷ lại như mở lại HĐ).
 */
export function voidForSession(warn: Warn) {
  return async (p: ESignProvider | null, e: EnvelopeRow, run: Run): Promise<boolean> => {
    const fail = (error: string) => {
      warn?.("esign-session-void-failed", { envelope: e.id, error });
      return false;
    };
    const ok = p
      ? await p.voidEnvelope(e.envelopeId, SESSION_ENDED).then(
          () => true,
          (err: unknown) => fail(errName(err)),
        )
      : fail("provider-unavailable");
    const patch = ok
      ? { status: "voided" as const, reason: SESSION_ENDED }
      : { status: e.status, reason: VOID_PENDING };
    await run((r) =>
      r.esign.update(e.envelopeId, { ...patch, completedAt: null, signers: e.signers }),
    );
    return ok;
  };
}

/** Trả true khi đã huỷ được ở nhà cung cấp (hàng ⇒ `voided`). */
export function voidForReopen(warn: Warn) {
  return async (p: ESignProvider | null, e: EnvelopeRow, run: Run): Promise<boolean> => {
    const fail = (error: string) => {
      warn?.("esign-void-failed", { envelope: e.id, error });
      return false;
    };
    const ok = p
      ? await p.voidEnvelope(e.envelopeId, REOPENED).then(
          () => true,
          (err: unknown) => fail(errName(err)),
        )
      : fail("provider-unavailable");
    const patch = ok
      ? { status: "voided" as const, reason: REOPENED }
      : { status: e.status, reason: VOID_PENDING };
    await run((r) =>
      r.esign.update(e.envelopeId, { ...patch, completedAt: null, signers: e.signers }),
    );
    return ok;
  };
}
