// CR-182 · R7 / CR-188 · BR-188-6 «Kiểm tra tệp»: luật thuần. Máy chủ băm sha256 tệp tải lên rồi so với MỌI bản đã ký của công ty
// (HĐ, phụ lục, giấy tờ khác, mọi phiên bản chưa bị huỷ). Tệp gốc chưa ký không tính (Q3). Khớp HĐ người gọi KHÔNG xem được ⇒ chỉ báo
// «có khớp», phản hồi cùng hình dạng nhưng mọi chi tiết là null.
import { checkCode } from "./approval-record.rules";

export type DocKind = "contract" | "appendix" | "other";

/** Một bản đã ký khớp tệp. `visible=false` ⇒ HĐ ngoài quyền xem của người gọi: tầng SQL KHÔNG trả chi tiết (các trường còn lại null). */
export type VerifyCandidate = {
  visible: boolean;
  contractId: string | null;
  contractTitle: string | null;
  /** `other` = giấy tờ khác (chứng từ không phải HĐ/phụ lục). */
  docKind: DocKind | null;
  partner: string | null;
  sha256: string;
  signedBy: string | null;
  signedAt: string | null;
  fileId: string | null;
  seq: number | null;
  versionId: string | null;
};

/** Một hình dạng duy nhất cho mọi kết quả (không phân biệt «không thấy» với «thấy» qua khoá có/không). */
export type VerifyOutcome = {
  match: boolean;
  /** Người gọi có quyền xem giấy tờ khớp (luôn false khi không khớp). */
  visible: boolean;
  /** Gọi kèm `from_contract_id` mà tệp là bản đã ký của HĐ khác. */
  other: boolean;
  contract: { id: string; title: string; kind: DocKind; partner: string | null } | null;
  check_code: string | null;
  signed_by: string | null;
  signed_at: string | null;
  file_id: string | null;
  seq: number | null;
  version_id: string | null;
};

export const SHA256_RE = /^[0-9a-f]{64}$/;

const EMPTY: VerifyOutcome = {
  match: false,
  visible: false,
  other: false,
  contract: null,
  check_code: null,
  signed_by: null,
  signed_at: null,
  file_id: null,
  seq: null,
  version_id: null,
};

export const docKindOf = (kind: string, docType: string): DocKind =>
  kind === "appendix" ? "appendix" : docType === "contract" ? "contract" : "other";

/**
 * Chọn kết quả: ưu tiên bản của HĐ đang mở (`fromContractId`), rồi bản ký mới nhất. Không khớp ⇒ `EMPTY`.
 * Không thấy ⇒ `match:true, visible:false`, mọi chi tiết null.
 */
export function pickMatch(
  rows: readonly VerifyCandidate[],
  fromContractId: string | null = null,
): VerifyOutcome {
  const mine = fromContractId
    ? rows.find((r) => r.visible && r.contractId === fromContractId)
    : undefined;
  const m = mine ?? [...rows].sort((a, b) => (b.signedAt ?? "").localeCompare(a.signedAt ?? ""))[0];
  if (!m) return { ...EMPTY };
  const other = fromContractId !== null && m.contractId !== fromContractId;
  if (!m.visible || m.contractId === null) return { ...EMPTY, match: true, other };
  return {
    match: true,
    visible: true,
    other,
    contract: {
      id: m.contractId,
      title: m.contractTitle ?? "",
      kind: m.docKind ?? "contract",
      partner: m.partner,
    },
    check_code: checkCode(m.sha256),
    signed_by: m.signedBy,
    signed_at: m.signedAt,
    file_id: m.fileId,
    seq: m.seq,
    version_id: m.versionId,
  };
}
