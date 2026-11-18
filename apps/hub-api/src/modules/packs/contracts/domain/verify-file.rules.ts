// CR-182 · R7 «Kiểm tra tệp»: luật thuần. Máy chủ tính sha256 của tệp tải lên rồi so với dấu vân tay đã lưu (bản đã ký + tệp gốc cần ký).
import { checkCode } from "./approval-record.rules";

/** Một bản đã lưu khớp với tệp (đã lọc theo công ty + quyền xem HĐ ở tầng SQL). */
export type VerifyCandidate = {
  contractId: string;
  contractTitle: string;
  /** `original` = tệp gốc cần ký; `signed` = bản sau khi người ký. */
  which: "original" | "signed";
  sha256: string;
  /** Id người ký (chỉ khi `signed`). */
  signedBy: string | null;
  signedAt: string | null;
  /** Bản đã ký để mở «Xem bản đã ký» (chỉ khi `signed`). */
  fileId: string | null;
  seq: number | null;
  versionId: string | null;
};

export type VerifyOutcome =
  | { match: false }
  | {
      match: true;
      which: "original" | "signed";
      contract: { id: string; title: string };
      check_code: string;
      signed_by: string | null;
      signed_at: string | null;
      file_id: string | null;
      seq: number | null;
      version_id: string | null;
    };

export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Bản đã ký ưu tiên hơn tệp gốc (cùng sha hiếm khi xảy ra: tệp gốc đã có sẵn dấu ⇒ không đổi). Nhiều bản ⇒ bản mới nhất. */
export function pickMatch(rows: readonly VerifyCandidate[]): VerifyOutcome {
  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.which === "signed") - Number(a.which === "signed") ||
      (b.signedAt ?? "").localeCompare(a.signedAt ?? ""),
  );
  const m = sorted[0];
  if (!m) return { match: false };
  return {
    match: true,
    which: m.which,
    contract: { id: m.contractId, title: m.contractTitle },
    check_code: checkCode(m.sha256),
    signed_by: m.signedBy,
    signed_at: m.signedAt,
    file_id: m.fileId,
    seq: m.seq,
    version_id: m.versionId,
  };
}
