// ADR-0037 · cửa công khai DUY NHẤT của module `signatures` (CR-181): module khác chỉ import file này (theo tên, không `export *`).
import type { SignatureKind, SignatureSettings } from "@ai/contracts/signature";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { signaturesRepo } from "./adapters/signatures.repo";

export { type SignaturesRepo, signaturesRepo } from "./adapters/signatures.repo";
export {
  canChangeNow,
  changeNeedsGrant,
  checkPng,
  needsCreate,
  profileCaption,
} from "./domain/signature.rules";
export type {
  ChangeGrantResult,
  ChangeGrantState,
  ChangeRequestRow,
  SignatureCreated,
  SignatureHistoryRow,
  SignatureRecord,
  SignatureSettingsRecord,
} from "./domain/signature.types";
export type { SignaturesMountDeps } from "./signatures.mount";
export { mountSignatures, SIGNATURE_PROTECTED_PREFIXES } from "./signatures.mount";

/** Thiết lập chữ ký của MỘT công ty (mặc định nếu chưa lưu) — cho gói khác/máy chủ in (lát s8). Một câu SQL, scope `system` (hàm DB lọc theo tenant). */
export async function getSignatureSettings(db: Db, tenantId: string): Promise<SignatureSettings> {
  const rec = await withHubScope(db, { kind: "system" }, (tx) =>
    signaturesRepo(tx).settingsOfTenant(tenantId),
  );
  return rec.settings;
}

/**
 * Chữ ký ĐANG DÙNG của người ký (BR-K3): máy chủ in lấy ảnh từ DB, không nhận ảnh từ trình duyệt. `ctx` = người đang đăng nhập (JWT);
 * hàm DB từ chối (42501) nếu tham số lệch ngữ cảnh ⇒ không đọc hộ người khác. null = chưa có chữ ký loại này.
 */
export async function signatureForStamp(
  db: Db,
  ctx: { tenantId: string; userId: string },
  kind: SignatureKind,
): Promise<{ id: string; png: Buffer } | null> {
  const r = await withHubScope(db, { kind: "user", ...ctx }, (tx) =>
    signaturesRepo(tx).signatureForStamp(ctx.tenantId, ctx.userId, kind),
  );
  return r ? { id: r.id, png: r.png } : null;
}
