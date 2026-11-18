// CR-182 · hàm thuần của trang ký công khai: trạng thái trang từ mã lỗi/dữ liệu link, mục trên màn ký từ tệp được gửi, body POST (chỉ vị trí).
import {
  PARTNER_SIGN_ERRORS,
  type PartnerSignBody,
  type PartnerSignFileOut,
  type PartnerSignViewOut,
  SIGN_FIELD_ASPECT,
} from "@ai/contracts/pack-contracts";
import { buildSignBody } from "~/features/doc-sign/lib/session-map";
import type { SignItem } from "~/features/doc-sign/lib/sign-items";

/** Trạng thái của cả trang: quyết định hiện gì. */
export type PartnerPageState =
  | "invite" // mở, còn ký được
  | "signed" // đã ký xong
  | "declined" // đã từ chối
  | "gone" // hết hạn / thu hồi (410)
  | "notfound" // link sai (404)
  | "limit" // quá nhiều lần mở (429)
  | "error";

export type PartnerLoadError = { status: number } | null | undefined;

/** Từ kết quả `GET /sign-link/:token`. */
export function pageState(
  view: PartnerSignViewOut | undefined,
  err: PartnerLoadError,
): PartnerPageState {
  if (view) return view.state === "open" ? "invite" : view.state;
  const s = err?.status;
  if (s === 410) return "gone";
  if (s === 404) return "notfound";
  if (s === 429) return "limit";
  return "error";
}

/** Số chỗ ký còn mở của đối tác (chưa ký) trên mọi tệp. */
export const openFieldCount = (files: PartnerSignFileOut[]): number =>
  files.reduce((n, f) => n + f.fields.filter((x) => !x.signed).length, 0);

/** Tệp còn chỗ ký chưa ký (chỉ các tệp này vào màn ký). */
export const filesToSign = (files: PartnerSignFileOut[]): PartnerSignFileOut[] =>
  files.filter((f) => f.fields.some((x) => !x.signed));

/** Mục ban đầu của một tệp: chỗ chưa ký = ô của đối tác (`mine`, Bên B). Ô đã ký đã in sẵn trong PDF. */
export function partnerItems(f: PartnerSignFileOut, person: string): SignItem[] {
  return f.fields
    .filter((x) => !x.signed)
    .map((x) => ({
      id: x.id,
      fieldId: x.id,
      kind: "field" as const,
      parts: x.parts,
      aspect: SIGN_FIELD_ASPECT,
      side: "B" as const,
      person: x.label || person,
      status: "mine" as const,
    }));
}

/** Body `POST sign` cho một tệp: chỉ vị trí (không ảnh). `null` = chưa có chữ ký nào để gửi. */
export function partnerSignBody(fileId: string, items: SignItem[]): PartnerSignBody | null {
  const { marks } = buildSignBody(items, "internal", false);
  return marks.length === 0 ? null : { file_id: fileId, marks };
}

/** Đường dẫn công khai của link (token đã mã hoá đoạn đường dẫn). */
export const linkBase = (token: string) => `/sign-link/${encodeURIComponent(token)}`;
export const filePath = (token: string, fileId: string) =>
  `${linkBase(token)}/files/${encodeURIComponent(fileId)}`;
export const versionPath = (token: string, fileId: string, versionId: string) =>
  `${linkBase(token)}/versions/${encodeURIComponent(fileId)}/${encodeURIComponent(versionId)}`;

const KNOWN = new Set<string>([
  PARTNER_SIGN_ERRORS.gone,
  PARTNER_SIGN_ERRORS.closed,
  PARTNER_SIGN_ERRORS.noQuick,
  PARTNER_SIGN_ERRORS.pngBad,
  PARTNER_SIGN_ERRORS.fieldForbidden,
  PARTNER_SIGN_ERRORS.markInvalid,
  PARTNER_SIGN_ERRORS.stale,
]);

/** Lỗi thao tác ⇒ khoá i18n nghiệp vụ (không lộ mã kỹ thuật). */
export function partnerErrorKey(e: unknown): string {
  const x = e as { code?: string; status?: number } | null;
  const base = "contracts.psign.err";
  if (x?.code && KNOWN.has(x.code)) return `${base}.${x.code}`;
  if (x?.status === 429) return `${base}.limit`;
  if (x?.status === 410) return `${base}.${PARTNER_SIGN_ERRORS.gone}`;
  if (x?.status === 409) return `${base}.${PARTNER_SIGN_ERRORS.closed}`;
  if (x?.status === 403) return `${base}.csrf`;
  return `${base}.generic`;
}

const TZ = "Asia/Ho_Chi_Minh";
/** Ngày theo giờ Việt Nam: «24/11/2026». */
export const fmtDate = (iso: string, lang: string): string =>
  new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "vi-VN", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
/** Ngày + giờ theo giờ Việt Nam: «24/11/2026 14:05». */
export const fmtDateTime = (iso: string, lang: string): string =>
  `${fmtDate(iso, lang)} ${new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  })}`;
