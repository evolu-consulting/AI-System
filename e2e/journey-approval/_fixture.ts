// e2e-journey-approval · dữ liệu thuần của hành trình: văn bản HĐ mẫu (Markdown — đường đọc chữ, không cần bộ chuyển DOCX/PDF của hub)
// và JSON "AI đọc" mà CLI Claude GIẢ của stack trả. Trích dẫn (quote) của JSON là NGUYÊN VĂN dòng trong HĐ mẫu.
// Không chứa bí mật; tên công ty là dữ liệu giả.

/** Thẻ gắn mọi dữ liệu do hành trình tạo (dùng để nhận ra / dọn khi chạy trên máy chủ thật). */
export const TAG = "E2E-JOURNEY";

export type ContractDoc = {
  text: string;
  title: string;
  supplier: string;
  line: Record<string, string>;
};

/** HĐ MUA mẫu (tenant là Bên mua). `run` làm tiêu đề duy nhất mỗi lượt chạy. */
export function buyContract(run: string): ContractDoc {
  const line = {
    title: `Hợp đồng mua văn phòng phẩm số ${TAG}-${run}/HĐMB`,
    supplier: `Bên bán (Bên A): Công ty TNHH ${TAG} Bên Bán`,
    buyer: "Bên mua (Bên B): Công ty E2E Approval Journey",
    term: "Hiệu lực từ 01/10/2026 đến 30/09/2027.",
    total: "Tổng giá trị hợp đồng: 11.500.000 đồng (đã gồm VAT 10%).",
  };
  const text = [
    `# ${line.title}`,
    "",
    "HỢP ĐỒNG MUA",
    "",
    "Ngày ký: 01/10/2026.",
    line.term,
    "",
    line.supplier,
    line.buyer,
    "",
    "## Điều 1. Hàng hoá và giá",
    "",
    "Bên A bán cho Bên B văn phòng phẩm theo đơn đặt hàng từng đợt.",
    line.total,
    "",
    "## Điều 2. Thanh toán",
    "",
    "Bên B thanh toán 100% trong 15 ngày kể từ ngày nhận hàng.",
  ].join("\n");
  return { text, title: line.title, supplier: `Công ty TNHH ${TAG} Bên Bán`, line };
}

const field = (value: unknown, quote: string) => ({ value, quote });

/** Đầu ra agent (đúng `ExtractionOutputSchema`) cho HĐ mua mẫu. `deal=buy` ⇒ luật chọn quy trình Phòng KD × Mua. */
export function extractionFor(doc: ContractDoc): Record<string, unknown> {
  const none = field(null, "");
  return {
    fields: {
      number: none,
      title: field(doc.title, doc.line.title.replace(/^# /, "")),
      type: none,
      supplier_name: field(doc.supplier, doc.line.supplier),
      supplier_tax_id: none,
      supplier_address: none,
      supplier_representative: none,
      buyer_name: field("Công ty E2E Approval Journey", doc.line.buyer),
      buyer_tax_id: none,
      buyer_representative: none,
      signed_date: field("2026-10-01", "Ngày ký: 01/10/2026."),
      start_date: field("2026-10-01", doc.line.term),
      end_date: field("2027-09-30", doc.line.term),
      effective_date: none,
      auto_renew: none,
      notice_days: none,
      total_value: field(11_500_000, doc.line.total),
      vat_rate: none,
      vat_included: none,
      payment_terms: none,
      delivery_terms: none,
      warranty: none,
      penalty: none,
    },
    items: [],
    clauses: [],
    deal: "buy",
    unsure: [],
    summary: null,
    milestones: [],
  };
}
