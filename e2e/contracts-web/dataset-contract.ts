// HD-FR-26 · D-02 · HD2: dữ liệu giả chung cho S05 (kiểm/sửa HĐ) — một HĐ chuẩn + hai bộ chuyển: `contractAsMgmt()` (hình
// `GET /api/contracts/:id` của mgmt-app, `ContractPage.tsx:11-14`) và `contractAsHub()` (hình `ContractDetail` của
// `@ai/contracts`). S04 (nhập tay) không cần dữ liệu.
import { dataset } from "./dataset";

type F = { value: string | number | boolean | null; quote: string; verified: boolean };
const KEYS = [
  "number",
  "title",
  "type",
  "supplier_name",
  "supplier_tax_id",
  "supplier_address",
  "supplier_representative",
  "buyer_name",
  "buyer_tax_id",
  "buyer_representative",
  "signed_date",
  "start_date",
  "end_date",
  "effective_date",
  "auto_renew",
  "notice_days",
  "total_value",
  "vat_rate",
  "vat_included",
  "payment_terms",
  "delivery_terms",
  "warranty",
  "penalty",
] as const;

export const contract = {
  id: "c1000000-0000-4000-8000-000000000001",
  title: "hd-bao-bi-2026",
  status: "needs_review" as string,
  fields: {
    number: {
      value: "01/2026/HĐMB-PN",
      quote: "HỢP ĐỒNG MUA BÁN Số: 01/2026/HĐMB-PN",
      verified: true,
    },
    title: { value: "Hợp đồng mua bán bao bì 2026", quote: "", verified: false },
    supplier_name: {
      value: "Công ty TNHH Bao Bì Phương Nam",
      quote: "Bên bán: Công ty TNHH Bao Bì Phương Nam",
      verified: true,
    },
    supplier_tax_id: { value: "0312345678", quote: "Mã số thuế: 0312345678", verified: true },
    buyer_name: {
      value: "Công ty CP Thực phẩm An Khang",
      quote: "Bên mua: Công ty CP Thực phẩm An Khang",
      verified: true,
    },
    buyer_tax_id: { value: "0109876543", quote: "Mã số thuế: 0109876543", verified: true },
    supplier_representative: {
      value: "Nguyễn Văn Phúc – Giám đốc",
      quote: "Đại diện: Ông Nguyễn Văn Phúc, chức vụ: Giám đốc",
      verified: true,
    },
    buyer_representative: {
      value: "Trần Thị Mai – Phó Giám đốc",
      quote: "Đại diện: Bà Trần Thị Mai, chức vụ: Phó Giám đốc",
      verified: true,
    },
    start_date: { value: "2026-01-01", quote: "có hiệu lực từ ngày 01/01/2026", verified: true },
    end_date: { value: "2026-12-31", quote: "đến hết ngày 31/12/2026", verified: true },
    notice_days: { value: 30, quote: "báo trước ít nhất 30 ngày", verified: true },
    total_value: {
      value: 245000000,
      quote: "Tổng giá trị theo bảng giá đính kèm",
      verified: false,
    },
    payment_terms: {
      value: "Chuyển khoản trong 30 ngày kể từ ngày nhận hoá đơn",
      quote: "",
      verified: false,
    },
  } as Partial<Record<(typeof KEYS)[number], F>>,
  items: [
    { name: "Thùng carton 5 lớp 60×40×40", unit: "thùng", qty: 1000, unit_price: 8500 },
    { name: "Màng co PE 25 micron", unit: "cuộn", qty: 500, unit_price: 320000 },
  ],
  warnings: [
    {
      field: "vat_included",
      code: "vat_unknown",
      message: "Chưa xác định giá đã gồm VAT hay chưa.",
    },
    {
      field: null,
      code: "direction_unknown",
      message:
        "Không bên nào là pháp nhân của mình, nên chưa biết đây là HĐ mua hay bán. Kiểm tra MST hai bên, hoặc đánh dấu pháp nhân trong mục Đối tác.",
    },
  ],
  file: { name: "hd-bao-bi-2026.pdf", size: 182_000, mime: "application/pdf" },
};

const full = (f: F | undefined, edited = false) => ({
  value: f?.value ?? null,
  quote: f?.quote ?? "",
  verified: f?.verified ?? false,
  edited,
});

export function contractAsMgmt(status = contract.status) {
  const c = contract;
  return {
    id: c.id,
    title: c.title,
    status,
    fields: Object.fromEntries(KEYS.map((k) => [k, full(c.fields[k])])),
    items: c.items,
    warnings: c.warnings.map((w) => ({ field: w.field, message: w.message })),
    file: c.file,
  };
}

export function contractAsHub(status = contract.status) {
  const c = contract;
  const at = "2026-10-18T02:00:00.000Z";
  return {
    id: c.id,
    kind: "contract",
    parent_id: null,
    title: c.title,
    status,
    direction: null,
    owner_user_id: dataset.user.id,
    updated_at: at,
    version: 3,
    number: c.fields.number?.value,
    seller: c.fields.supplier_name?.value,
    buyer: c.fields.buyer_name?.value,
    seller_signer: null,
    buyer_signer: null,
    type: null,
    value: 245000000,
    end_date: "2026-12-31",
    action_deadline: null,
    error: null,
    created_by: dataset.user.id,
    created_at: at,
    confirmed_at: null,
    confirmed_by: null,
    file_id: "f1000000-0000-4000-8000-000000000001",
    clauses: [],
    warnings: c.warnings,
    handled: null,
    run_id: null,
    fields: Object.fromEntries(KEYS.map((k) => [k, full(c.fields[k])])),
    items: c.items.map((it, i) => ({
      id: `e1000000-0000-4000-8000-00000000000${i + 1}`,
      ord: i,
      code: null,
      spec: null,
      vat_rate: null,
      moq: null,
      lead_time_days: null,
      valid_from: null,
      valid_to: null,
      category_id: null,
      quote: null,
      verified: true,
      edited: false,
      product_id: null,
      component_ids: null,
      ...it,
    })),
    events: [],
    file: {
      id: "f1000000-0000-4000-8000-000000000001",
      name: c.file.name,
      mime: c.file.mime,
      size_bytes: c.file.size,
    },
    has_source: false,
    parent: null,
    appendices: [],
    // V2-A/V2-F: loại HĐ, hoa hồng, ngày bắt đầu, giai đoạn + dòng thời gian mốc (HĐ chờ xác nhận ⇒ chưa có mốc).
    deal: "buy",
    commission_pct: null,
    commission_fixed: null,
    start_date: "2026-01-01",
    stage: "not_started",
    next_milestone_id: null,
    milestones: [] as unknown[],
    // V2-G: phần AI đọc (null = nhập tay / bản đọc cũ ⇒ màn xác nhận giữ luồng PATCH của V2-F).
    ai: null as unknown,
  };
}
