// CR-122 · E5c · phong bì của node Ký số quá hạn (tách khỏi `esign.usecase.ts`, trần 400 dòng): huỷ ở nhà cung cấp + `voided` rồi bắn trạng thái
// cuối (`esign.voided`) cho lượt đang chờ — cùng đường hook `onStatus` như webhook. Lớp 2: chỉ cổng.
import type { PackSystemUow } from "../../kit/public";
import { type ESignStatus, isOpen } from "../domain/esign.rules";
import type { EnvelopeRow, ESignProvider, ESignRepo } from "./esign.ports";
import { errName } from "./esign-void";

type R = { esign: ESignRepo };
type Run = <T>(fn: (r: R) => Promise<T>) => Promise<T>;
export type EsignExpireDeps = {
  uow: PackSystemUow<R>;
  avail: (provider: string) => ESignProvider | null;
  voidExpired: (p: ESignProvider | null, e: EnvelopeRow, run: Run) => Promise<boolean>;
  onStatus?: (tenantId: string, contractId: string, status: ESignStatus) => Promise<void>;
  warn?: (msg: string, meta: Record<string, unknown>) => void;
};

/** E5d · lease giữ quyền huỷ: tiến trình giữ mà chết giữa chừng ⇒ sau chừng này phút bên khác giành lại được. */
export const ESIGN_EXPIRE_LEASE_MIN = 10;

/**
 * Huỷ ĐÚNG phong bì `envelopeId` (hàng đã quét) khi còn mở + đã quá hạn lúc `now`: GIÀNH quyền bằng một UPDATE có điều kiện TRƯỚC khi gọi nhà
 * cung cấp — hai tiến trình quét cùng lúc chỉ MỘT bên giành được ⇒ một lần `voidEnvelope`, một sự kiện `esign.voided`. Không giành được /
 * phong bì khác của HĐ (gửi lại sau khi quét) / huỷ ở nhà cung cấp hụt ⇒ false (hụt: lease hết hạn thì lượt sau thử lại). Hook lỗi chỉ log.
 */
export function esignExpire(d: EsignExpireDeps) {
  return async (
    tenantId: string,
    contractId: string,
    envelopeId: string,
    now: Date,
  ): Promise<boolean> => {
    const run: Run = (fn) => d.uow.system(tenantId, fn);
    const e = await run((r) => r.esign.claimExpire(envelopeId, now, ESIGN_EXPIRE_LEASE_MIN));
    if (!e || e.contractId !== contractId || !isOpen(e.status)) return false;
    if (!(await d.voidExpired(d.avail(e.provider), e, run))) return false;
    await d
      .onStatus?.(tenantId, contractId, "voided")
      .catch((err: unknown) =>
        d.warn?.("esign-flow-hook-failed", { contract_id: contractId, error: errName(err) }),
      );
    return true;
  };
}
