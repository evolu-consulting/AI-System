// CR-182 · R7 / CR-188 · `POST /pack/contracts/verify-file` (multipart `file` + tuỳ chọn `from_contract_id`). Cùng một hình dạng cho mọi kết quả.
import { api } from "@ai/web-kit/http";

export type VerifyDocKind = "contract" | "appendix" | "other";

export type VerifyResult = {
  match: boolean;
  /** Có quyền xem giấy tờ khớp; false ⇒ chỉ biết «có khớp», không chi tiết. */
  visible: boolean;
  /** Mở từ một HĐ mà tệp là bản đã ký của HĐ khác. */
  other: boolean;
  contract: { id: string; title: string; kind: VerifyDocKind; partner: string | null } | null;
  check_code: string | null;
  signed_by: string | null;
  signed_at: string | null;
  file_id: string | null;
  seq: number | null;
  version_id: string | null;
};

export function verifyFile(file: File, fromContractId?: string): Promise<VerifyResult> {
  const form = new FormData();
  form.append("file", file);
  if (fromContractId) form.append("from_contract_id", fromContractId);
  return api<VerifyResult>("/pack/contracts/verify-file", {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
}
