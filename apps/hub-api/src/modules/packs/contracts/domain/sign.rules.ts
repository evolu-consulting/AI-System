// CR-181 · s8 · «Ký trên tài liệu» phía HĐ — luật thuần (không DB): ai chuẩn bị chỗ ký (BR-T1/C2), tệp cần ký (Q13/Q14, BR-T3),
// kiểm chỗ ký (BR-C1), mặc định, sẵn sàng gửi duyệt (BR-C3), chế độ màn ký.
import {
  SIGN_DOC_PAGES_MAX,
  SIGN_FIELDS_MAX,
  type SignerKindApi,
  type SignParts,
  type SignReadinessOut,
  type SignSide,
} from "@ai/contracts/pack-contracts";
import { isContractFilesLocked } from "./contract-files.rules";

export type SignerEntry = {
  side: SignSide;
  kind: SignerKindApi;
  ref: string;
  name: string;
  mine: boolean;
  members?: { id: string; name: string }[];
};
export const signerKey = (kind: string, ref: string): string => `${kind}:${ref.toLowerCase()}`;

/** Người tải lên: tệp chính = người tạo HĐ; tệp kèm = người gắn (`added_by`). */
export const uploaderOf = (
  f: { is_main: boolean; added_by: string | null },
  contractCreator: string,
): string => (f.is_main ? contractCreator : (f.added_by ?? contractCreator));

/** BR-T1/C2 · CHỈ người tải lên (quản trị gói cũng không), và chỉ khi HĐ chưa khoá (Nháp / bị trả lại). */
export const canPrepSign = (
  actor: string,
  uploader: string,
  contract: { status: string },
): boolean => actor === uploader && !isContractFilesLocked(contract);

export const isPdfFile = (f: { name: string; mime: string }): boolean =>
  f.mime.toLowerCase() === "application/pdf" || /\.pdf$/i.test(f.name);

/** Q14 · chưa có hàng cờ: tệp chính bật khi công ty bật (và là PDF), tệp kèm tắt. */
export const defaultNeedsSign = (
  f: { is_main: boolean; is_pdf: boolean },
  companyOn: boolean,
): boolean => companyOn && f.is_main && f.is_pdf;

/** `sha256` = dấu vân tay tệp (CR-182 R7), có khi đọc thật; mô phỏng trong test có thể bỏ. */
export type PdfProbe =
  | { ok: true; pages: number; sha256?: string }
  | { ok: false; reason: "encrypted" | "invalid" };
export type SignFileIssue =
  | "SIGN_NOT_PDF"
  | "SIGN_PDF_ENCRYPTED"
  | "SIGN_PDF_INVALID"
  | "SIGN_TOO_MANY_PAGES";

/** Q13/BR-T3 · tệp bật «Cần ký»: PDF, không mật khẩu, ≤ 50 trang. `probe` null khi chưa đọc được nội dung. */
export function needsSignIssue(isPdf: boolean, probe: PdfProbe | null): SignFileIssue | null {
  if (!isPdf) return "SIGN_NOT_PDF";
  if (!probe) return "SIGN_PDF_INVALID";
  if (!probe.ok) return probe.reason === "encrypted" ? "SIGN_PDF_ENCRYPTED" : "SIGN_PDF_INVALID";
  return probe.pages > SIGN_DOC_PAGES_MAX ? "SIGN_TOO_MANY_PAGES" : null;
}

export type FieldIn = {
  id?: string | undefined;
  side: SignSide;
  signer_kind: SignerKindApi;
  signer_ref: string;
  parts: SignParts;
};
export type FieldIssue = "SIGN_FIELDS_TOO_MANY" | "SIGN_SIGNER_UNKNOWN" | "SIGN_PAGE_NOT_FOUND";

/** BR-C1 · mỗi chỗ ký đúng MỘT người ký thuộc danh sách (đúng bên); phần nằm trong số trang của tệp. Trả mã lỗi đầu tiên hoặc null. */
export function fieldsIssue(
  fields: readonly FieldIn[],
  signers: readonly SignerEntry[],
  pages: number | null,
): FieldIssue | null {
  if (fields.length > SIGN_FIELDS_MAX) return "SIGN_FIELDS_TOO_MANY";
  const known = new Set(signers.map((s) => `${s.side}|${signerKey(s.kind, s.ref)}`));
  for (const f of fields) {
    if (!known.has(`${f.side}|${signerKey(f.signer_kind, f.signer_ref)}`))
      return "SIGN_SIGNER_UNKNOWN";
    if (pages !== null && f.parts.some((p) => p.page >= pages)) return "SIGN_PAGE_NOT_FOUND";
  }
  return null;
}

/** Chuẩn hoá danh sách gửi lên: id lạ/trùng ⇒ id mới do máy chủ sinh; id của chỗ ĐÃ ký ⇒ bỏ (chỗ đã ký giữ nguyên). */
export function normalizeFields(
  input: readonly FieldIn[],
  existing: readonly { id: string; signed: boolean }[],
  newId: () => string,
): (FieldIn & { id: string })[] {
  const open = new Set(existing.filter((e) => !e.signed).map((e) => e.id));
  const signed = new Set(existing.filter((e) => e.signed).map((e) => e.id));
  const used = new Set<string>();
  const out: (FieldIn & { id: string })[] = [];
  for (const f of input) {
    if (f.id && signed.has(f.id)) continue;
    const id = f.id && open.has(f.id) && !used.has(f.id) ? f.id : newId();
    used.add(id);
    out.push({ ...f, id });
  }
  return out;
}

/** Nhãn chỗ ký (cột `label`): tên người ký. */
export const labelOf = (kind: string, ref: string, signers: readonly SignerEntry[]): string =>
  signers.find((s) => signerKey(s.kind, s.ref) === signerKey(kind, ref))?.name ?? ref;

/**
 * BR-C3 · còn thiếu gì để Gửi duyệt: (a) không có tệp cần ký; (b) tệp cần ký thiếu chỗ ký cho một người ký công ty (Bên A).
 * Q6: chỗ ký Bên B không bắt buộc. Lát s9 quyết có áp hay không (chỉ khi quy trình có bước ký trên tài liệu — BR-T2).
 */
export function signReadiness(
  files: readonly { file_id: string; name: string; needs_sign: boolean }[],
  fields: readonly { file_id: string; signer_kind: string; signer_ref: string }[],
  signers: readonly SignerEntry[],
): SignReadinessOut {
  const need = files.filter((f) => f.needs_sign);
  if (need.length === 0) return { ready: false, missing: [{ code: "NO_SIGN_FILE" }] };
  const has = new Set(fields.map((f) => `${f.file_id}|${signerKey(f.signer_kind, f.signer_ref)}`));
  const missing: SignReadinessOut["missing"] = [];
  for (const f of need)
    for (const s of signers.filter((x) => x.side === "A"))
      if (!has.has(`${f.file_id}|${signerKey(s.kind, s.ref)}`))
        missing.push({
          code: "NO_FIELD",
          file_id: f.file_id,
          file_name: f.name,
          signer_kind: s.kind,
          signer_ref: s.ref,
          signer_name: s.name,
        });
  return { ready: missing.length === 0, missing };
}

/** Chế độ màn: người tải lên khi chưa khoá ⇒ prep; có lượt ⇒ sign; còn lại view. */
export const sessionMode = (anyCanPrep: boolean, turnAllowed: boolean): "prep" | "sign" | "view" =>
  anyCanPrep ? "prep" : turnAllowed ? "sign" : "view";

export type MarkIn = {
  field_id?: string | undefined;
  placement: "field" | "free" | "seam" | "initials";
};
/**
 * BR-C1/L2 · kiểm dấu gửi lên: dấu vào ô (`field`) phải có `field_id` là chỗ ký CHƯA ký của CHÍNH người gọi trên đúng tệp này.
 * `forbidden` ⇒ 403 (chỗ của người khác / đã ký / không thuộc tệp); `invalid` ⇒ 422 (field_id lệch kiểu dấu, trùng).
 */
export function marksIssue(
  marks: readonly MarkIn[],
  fields: readonly {
    id: string;
    signer_kind: string;
    signer_ref: string;
    signed_version_id: string | null;
  }[],
  signers: readonly SignerEntry[],
): "forbidden" | "invalid" | null {
  const seen = new Set<string>();
  for (const m of marks) {
    if ((m.placement === "field") !== (m.field_id !== undefined)) return "invalid";
    if (!m.field_id) continue;
    if (seen.has(m.field_id)) return "invalid";
    seen.add(m.field_id);
    const f = fields.find((x) => x.id === m.field_id);
    if (!f || f.signed_version_id !== null) return "forbidden";
    const mine = signers.some(
      (s) => s.mine && signerKey(s.kind, s.ref) === signerKey(f.signer_kind, f.signer_ref),
    );
    if (!mine) return "forbidden";
  }
  return null;
}

const vn = (d: Date) => new Date(d.getTime() + 7 * 3_600_000);
const p2 = (n: number) => String(n).padStart(2, "0");
/** BR-188-2 · dòng «Ký ngày dd/mm/yyyy hh:mm» — giờ Việt Nam (UTC+7), `now` = giờ máy chủ lúc ký. LUÔN in, không phụ thuộc thiết lập công ty. */
export function signedOnLine(now: Date): string {
  const t = vn(now);
  const date = `${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
  return `Ký ngày ${date} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
}

/** X2 · người không chuẩn bị chỗ ký chỉ thấy TÊN đối tác, không thấy email liên hệ: `ref` của người ký/chỗ ký đối tác bị che. */
export const PARTNER_REF_MASK = "partner";
export const maskPartnerRef = <T extends { kind: string; ref: string }>(s: T, prep: boolean): T =>
  prep || s.kind !== "partner" ? s : { ...s, ref: PARTNER_REF_MASK };
