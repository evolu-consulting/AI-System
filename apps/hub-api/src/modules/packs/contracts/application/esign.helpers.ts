// cf-esign-docusign + esign-multi · hàm thuần của use case ký số: map hàng ⇒ DTO, gộp trạng thái người ký, dựng người ký lưu (người ký
// công ty = CHÍNH tài khoản gửi), cài đặt hiệu lực từ registry (mặc định công ty ⇒ khả dụng đầu tiên).
import type {
  ESignEnvelopeOut,
  ESignErrorCode,
  ESignSettingsOut,
  ESignSignerIn,
  ESignStatus,
} from "@ai/contracts";
import { effectiveDefault, metaOf } from "../domain/esign.providers";
import { isOpen } from "../domain/esign.rules";
import type {
  ContractForSign,
  EnvelopeRow,
  ESignEnvelopeInfo,
  ESignProviderEntry,
  StoredSigner,
} from "./esign.ports";

export class ESignFail extends Error {
  constructor(
    readonly code: ESignErrorCode | "NOT_FOUND" | "VALIDATION",
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ESignFail";
  }
}

export const labelOf = (entries: readonly ESignProviderEntry[], key: string): string =>
  entries.find((e) => e.key === key)?.label ?? metaOf(key).label;

export const kindOf = (entries: readonly ESignProviderEntry[], key: string) =>
  entries.find((e) => e.key === key)?.kind ?? metaOf(key).kind;

export const envelopeOut = (e: EnvelopeRow, demo: boolean, label: string): ESignEnvelopeOut => ({
  id: e.id,
  provider: e.provider,
  provider_label: label,
  demo,
  status: e.status,
  signers: e.signers.map((s) => ({
    role: s.role,
    name: s.name,
    email: s.email,
    order: s.order,
    embedded: s.client_user_id !== null,
    status: s.status,
    signed_at: s.signed_at,
    provider: s.provider ?? null,
    certificate_ref: s.certificate_ref ?? null,
  })),
  reason: e.reason,
  completed_at: e.completedAt,
  created_at: e.createdAt,
  has_signed_file: e.signedFileId !== null,
});

/** Trạng thái người ký theo email từ nhà cung cấp; ký xong cả envelope mà không có chi tiết ⇒ coi mọi người đã ký. */
export function mergeSigners(
  s: StoredSigner[],
  info: ESignEnvelopeInfo,
  st: ESignStatus,
): StoredSigner[] {
  return s.map((x) => {
    const r = info.recipients.find((y) => y.email.toLowerCase() === x.email);
    if (r) return { ...x, status: r.status, signed_at: r.signedAt };
    return st === "completed" ? { ...x, status: "completed", signed_at: info.completedAt } : x;
  });
}

/** Gửi ký được: HĐ thấy được + đã duyệt xong (khoá) + chưa có envelope đang chờ + tệp PDF ⇒ tệp. */
export function sendableFile(c: ContractForSign | null, e: EnvelopeRow | null) {
  if (!c) throw new ESignFail("NOT_FOUND", "contract");
  if (!c.locked) throw new ESignFail("ESIGN_STATE", "not-approved");
  if (e && isOpen(e.status)) throw new ESignFail("ESIGN_STATE", "already-open");
  const f = c.file;
  if (f?.mime !== "application/pdf")
    throw new ESignFail("ESIGN_UNSUPPORTED_FILE", f ? "not-pdf" : "no-file");
  return f;
}

/** Thứ tự ký = thứ tự gửi. esign-multi: người ký công ty = CHÍNH tài khoản gửi (tên + email từ tài khoản, bỏ qua client gửi), ký
 *  nhúng (clientUserId = user); tài khoản không email ⇒ 422. Đối tác giữ nguyên (đã chuẩn hoá ở schema). */
export function storedSigners(
  signers: ESignSignerIn[],
  userId: string,
  me: { name: string; email: string | null },
): StoredSigner[] {
  const base = { status: null, signed_at: null, provider: null, certificate_ref: null };
  return signers.map((x, i) => {
    if (x.role === "partner") return { ...x, order: i + 1, client_user_id: null, ...base };
    const email = me.email?.trim().toLowerCase() ?? "";
    if (email === "") throw new ESignFail("ESIGN_SIGNER_NO_EMAIL", "account-email");
    const name = me.name.trim().normalize("NFC").slice(0, 100) || email;
    return { role: "company", name, email, order: i + 1, client_user_id: userId, ...base };
  });
}

/** Cài đặt hiệu lực: không FileBox ⇒ mọi nhà cung cấp coi như không khả dụng (tính năng tắt). */
export function settingsOut(
  entries: readonly ESignProviderEntry[],
  hasFiles: boolean,
  s: { enabled: boolean; defaultProvider: string | null },
  demoOf: (key: string) => boolean,
): ESignSettingsOut {
  const list = entries.map((e) => ({ ...e, available: e.available && hasFiles }));
  const def = effectiveDefault(list, s.defaultProvider);
  return {
    configured: def !== null,
    enabled: s.enabled,
    provider: def,
    demo: def ? demoOf(def) : false,
    providers: list.map((e) => ({
      key: e.key,
      label: e.label,
      kind: e.kind,
      available: e.available,
      legal: e.legal,
    })),
    default_provider: def,
  };
}
