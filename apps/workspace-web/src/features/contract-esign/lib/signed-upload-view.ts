// CR-141 · luật thuần khối «Tải lên bản đã ký»: khi nào hiện, tệp nhận được, câu lỗi theo mã máy chủ.
import type { SignedUploadStateOut } from "../api";

export const SIGNED_ACCEPT = ".pdf,.jpg,.jpeg,.png";
const EXT = /\.(pdf|jpe?g|png)$/i;

/** Chỉ hiện khi bước ký đang chờ VÀ người xem được tải (người được giao, hoặc Toàn quyền tải thay). */
export const showSignedUpload = (s: SignedUploadStateOut | undefined): boolean =>
  s?.awaiting === true && s.can_upload === true;

/** Người Toàn quyền tải thay người được giao ⇒ hiện dòng «duyệt thay». */
export const isUploadOverride = (s: SignedUploadStateOut | undefined): boolean =>
  showSignedUpload(s) && s?.override === true;

export const isSignedFileName = (name: string): boolean => EXT.test(name);

const ERR_CODES = new Set([
  "FILE_TYPE",
  "SIGN_UPLOAD_CONTENT",
  "FILE_TOO_LARGE",
  "SIGN_UPLOAD_NOT_AWAITING",
  "PACK_FORBIDDEN",
]);
/** Khoá i18n `contracts.esign.upload.err.*`; mã lạ ⇒ unknown. */
export const uploadErrKey = (code: string | undefined | null): string =>
  `contracts.esign.upload.err.${code && ERR_CODES.has(code) ? code : "unknown"}`;
