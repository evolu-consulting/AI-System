// esign-flow-fix · huỷ phong bì đang mở vì mở lại HĐ (K4). Huỷ ở nhà cung cấp OK ⇒ ghi `voided` (bản đã ký cũ giữ lịch sử); hụt / nhà
// cung cấp không khả dụng ⇒ GIỮ trạng thái mở, `reason = VOID_PENDING` + log — làm mới/webhook (`sync`) thử huỷ lại. Lớp 2.
import type { EnvelopeRow, ESignProvider, ESignRepo } from "./esign.ports";

export const REOPENED = "contract-reopened";
/** `reason` của phong bì còn mở mà lần huỷ (mở lại HĐ) hụt ở nhà cung cấp. */
export const VOID_PENDING = "void-pending:contract-reopened";
export const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

type Run = <T>(fn: (r: { esign: ESignRepo }) => Promise<T>) => Promise<T>;
type Warn = ((msg: string, meta: Record<string, unknown>) => void) | undefined;

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
