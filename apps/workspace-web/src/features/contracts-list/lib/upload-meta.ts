// DOC-ui-gaps · mục 3 DOC-ui-list: loại chứng từ chọn khi tải lên — HĐ kinh tế (có thể thuộc một HĐ nguyên tắc) hoặc HĐ nguyên tắc (hạn mức
// tuỳ chọn + cách đặt hàng). Giao dịch không tải lên bằng tệp (nhập tay ở `/contracts/new?type=deal`, gắn file = nâng thành HĐ).
// Thuần: dựng trường multipart `POST /contracts` (`UploadDocFormSchema`), không React.
import { ORDER_TERMS_MAX } from "@ai/contracts";
import { parseMoney } from "~/components/shared/format";

export const UPLOAD_DOC_TYPES = ["contract", "framework"] as const;
export type UploadDocType = (typeof UPLOAD_DOC_TYPES)[number];

export type UploadMeta = {
  doc_type: UploadDocType;
  frame_root_id?: string;
  credit_limit?: number;
  order_terms?: string;
};

export type MetaDraft = {
  docType: UploadDocType;
  frameId: string | null;
  creditLimit: string;
  orderTerms: string;
};
export const EMPTY_DRAFT: MetaDraft = {
  docType: "contract",
  frameId: null,
  creditLimit: "",
  orderTerms: "",
};

export type MetaResult = { ok: true; meta: UploadMeta } | { ok: false; error: "credit" | "terms" };

/** Nháp ⇒ trường tải lên; hạn mức sai (không đọc được / âm) hoặc cách đặt hàng quá dài ⇒ lỗi. HĐ kinh tế không mang hạn mức/cách đặt hàng. */
export function toUploadMeta(d: MetaDraft): MetaResult {
  if (d.docType === "contract")
    return {
      ok: true,
      meta: { doc_type: "contract", ...(d.frameId ? { frame_root_id: d.frameId } : {}) },
    };
  const meta: UploadMeta = { doc_type: "framework" };
  if (d.creditLimit.trim()) {
    const n = parseMoney(d.creditLimit);
    if (n === null || Number.isNaN(n) || n < 0) return { ok: false, error: "credit" };
    meta.credit_limit = n;
  }
  const terms = d.orderTerms.trim();
  if (terms.length > ORDER_TERMS_MAX) return { ok: false, error: "terms" };
  if (terms) meta.order_terms = terms;
  return { ok: true, meta };
}

/** Trường chữ của multipart (chỉ khoá có giá trị). */
export function metaFields(m: UploadMeta | undefined): [string, string][] {
  if (!m) return [];
  const out: [string, string][] = [["doc_type", m.doc_type]];
  if (m.frame_root_id) out.push(["frame_root_id", m.frame_root_id]);
  if (m.credit_limit !== undefined) out.push(["credit_limit", String(m.credit_limit)]);
  if (m.order_terms) out.push(["order_terms", m.order_terms]);
  return out;
}
