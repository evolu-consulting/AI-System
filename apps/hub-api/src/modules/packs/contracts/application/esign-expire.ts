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

/** Không còn phong bì mở / huỷ ở nhà cung cấp hụt ⇒ false (vòng quét thử lại lượt sau). Hook lỗi chỉ log, không làm hỏng việc huỷ. */
export function esignExpire(d: EsignExpireDeps) {
  return async (tenantId: string, id: string): Promise<boolean> => {
    const run: Run = (fn) => d.uow.system(tenantId, fn);
    const e = await run((r) => r.esign.latest(id));
    if (!e || !isOpen(e.status)) return false;
    if (!(await d.voidExpired(d.avail(e.provider), e, run))) return false;
    await d
      .onStatus?.(tenantId, id, "voided")
      .catch((err: unknown) =>
        d.warn?.("esign-flow-hook-failed", { contract_id: id, error: errName(err) }),
      );
    return true;
  };
}
