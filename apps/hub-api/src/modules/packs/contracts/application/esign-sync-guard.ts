// CR-125 · m10 · webhook/đồng bộ của phong bì chỉ được rẽ nhánh lượt khi phong bì đó còn là phong bì SỐNG: không đang bị đổi cách ký (lease
// `switching` còn hạn) và chưa bị phong bì mới thay. Không thoả ⇒ bỏ qua cho luồng (không cập nhật, không tín hiệu), chỉ ghi audit khi trạng
// thái nhà cung cấp báo khác hàng. Kiểm trong MỘT UPDATE có điều kiện (`syncUpdate`) ⇒ không có khe giữa đọc và ghi.
import { type ESignStatus, isOpen } from "../domain/esign.rules";
import type { EnvelopeRow, ESignEnvelopeInfo, ESignRepo, StoredSigner } from "./esign.ports";
import { ESIGN_SWITCH_LEASE_MIN } from "./esign-switch";

type Run = <T>(fn: (r: { esign: ESignRepo }) => Promise<T>) => Promise<T>;
type Patch = {
  status: ESignStatus;
  reason: string | null;
  completedAt: string | null;
  signers: StoredSigner[];
};

/** Còn cần đồng bộ: còn mở, hoặc đã ký xong mà chưa lưu bản đã ký. */
export const syncable = (r: EnvelopeRow): boolean =>
  isOpen(r.status) || (r.status === "completed" && r.signedFileId === null);

/** Trạng thái nhà cung cấp ⇒ bản ghi hàng (lý do chỉ cho từ chối/huỷ; giờ xong chỉ cho đã ký). */
export const patchOf = (
  st: ESignStatus,
  info: ESignEnvelopeInfo,
  signers: StoredSigner[],
): Patch => ({
  status: st,
  reason: st === "declined" || st === "voided" ? info.reason : null,
  completedAt: st === "completed" ? (info.completedAt ?? new Date().toISOString()) : null,
  signers,
});

/** true ⇒ đã ghi, người gọi tiếp tục (lưu bản đã ký, hook lượt); false ⇒ bỏ qua. */
export async function syncApply(run: Run, row: EnvelopeRow, p: Patch): Promise<boolean> {
  return run(async (r) => {
    if (await r.esign.syncUpdate(row.envelopeId, row.status, p, ESIGN_SWITCH_LEASE_MIN))
      return true;
    if (p.status !== row.status)
      await r.esign.audit(
        row.sentBy,
        {
          esign_event_ignored: {
            contract_id: row.contractId,
            provider: row.provider,
            envelope_id: row.envelopeId,
          },
        },
        { esign_event_ignored: { status: p.status } },
      );
    return false;
  });
}
