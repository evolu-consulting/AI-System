// CR-125 · cr125-purchase-templates · MÔ TẢ 3 mẫu «Quy trình mua hàng» (đủ 11 dòng của bảng; xem docs/specs/CR-125/purchase-flow-trial.md).
// Đây là NGUỒN của kịch bản `purchase-templates.ts`: kịch bản đọc danh sách bước này và LÁI trình sửa (canvas/danh sách bước của quản trị
// nền tảng) để dựng từng mẫu — thêm bước, đặt tên, chọn nhóm theo MÃ, thêm trường form, đặt «Trả lại». Không gọi API để dựng bước.
// «A + B» duyệt = hai bước Duyệt NỐI TIẾP. «Giám đốc hoặc người được ủy quyền» = MỘT nhóm `giam-doc` chứa cả hai. Việc «làm» = bước form
// do nhóm tương ứng điền (có trường «Tệp đính kèm»). Dữ liệu hư cấu; mã nhóm = mã dùng chung với fixture seed (`TEMPLATE_GROUPS`).

export type FieldType =
  | "Văn bản ngắn"
  | "Văn bản dài"
  | "Số"
  | "Số tiền (đồng)"
  | "Ngày"
  | "Tệp đính kèm";
export type Field = { label: string; type: FieldType; required?: boolean };

export type Step =
  | { kind: "form"; id: string; name: string; group: string; fields: Field[] }
  | { kind: "approve"; id: string; name: string; group: string; backTo?: string[] }
  | { kind: "esign"; id: string; name: string }
  | { kind: "finish"; id: string; name: string };

export type Phase = {
  /** Mã Thư viện (khoá kỹ thuật, ổn định). */
  key: string;
  name: string;
  description: string;
  steps: Step[];
};

const f = (label: string, type: FieldType, required = false): Field => ({ label, type, required });
const file = (label: string): Field => f(label, "Tệp đính kèm");

export const GROUPS = {
  nv: ["nhan-vien-phong-ban", "Nhân viên phòng ban"],
  tbp: ["truong-bo-phan", "Trưởng bộ phận"],
  mh: ["mua-hang", "Mua hàng"],
  tmh: ["truong-mua-hang", "Trưởng mua hàng"],
  tc: ["tai-chinh", "Tài chính"],
  gd: ["giam-doc", "Giám đốc"],
  pc: ["phap-che", "Pháp chế"],
  kt: ["ke-toan", "Kế toán"],
  ktt: ["ke-toan-truong", "Kế toán trưởng"],
  kho: ["kho", "Kho"],
  tq: ["thu-quy", "Thủ quỹ"],
} as const;
type G = keyof typeof GROUPS;
const g = (k: G): string => GROUPS[k][0];

export const PHASES: Phase[] = [
  {
    key: "mua-hang-1-de-xuat-dat-hang",
    name: "Quy trình mua hàng · Phần 1: Đề xuất → Đặt hàng",
    description:
      "Dòng 1–5: đề xuất nhu cầu mua, báo giá, so sánh giá, duyệt ngân sách và phương án (Trả lại về bước so sánh giá), tạo PO.",
    steps: [
      {
        kind: "form",
        id: "p1-de-xuat",
        name: "1 Đề xuất nhu cầu mua",
        group: g("nv"),
        fields: [
          f("Nội dung cần mua", "Văn bản ngắn", true),
          f("Số lượng", "Số"),
          f("Dự toán", "Số tiền (đồng)"),
          file("Phiếu đề xuất mua"),
        ],
      },
      {
        kind: "approve",
        id: "p1-tbp-de-xuat",
        name: "1 Trưởng bộ phận duyệt đề xuất",
        group: g("tbp"),
      },
      {
        kind: "form",
        id: "p1-bao-gia",
        name: "2 Tìm nhà cung cấp, lấy báo giá",
        group: g("mh"),
        fields: [
          f("Nhà cung cấp", "Văn bản ngắn", true),
          f("Giá báo", "Số tiền (đồng)"),
          file("Tệp báo giá"),
        ],
      },
      {
        kind: "approve",
        id: "p1-tmh-bao-gia",
        name: "2 Trưởng mua hàng duyệt báo giá",
        group: g("tmh"),
      },
      {
        kind: "form",
        id: "p1-so-sanh",
        name: "3 Lập bảng so sánh giá, đề xuất chọn",
        group: g("mh"),
        fields: [
          f("Nhà cung cấp đề xuất", "Văn bản ngắn", true),
          f("Giá đề xuất", "Số tiền (đồng)"),
          file("Bảng so sánh giá"),
        ],
      },
      {
        kind: "approve",
        id: "p1-tbp-so-sanh",
        name: "3 Trưởng bộ phận duyệt phương án",
        group: g("tbp"),
      },
      { kind: "approve", id: "p1-tc-so-sanh", name: "3 Tài chính duyệt phương án", group: g("tc") },
      {
        kind: "form",
        id: "p1-ngan-sach",
        name: "4 Trình ngân sách và phương án",
        group: g("tc"),
        fields: [
          f("Ngân sách được duyệt", "Số tiền (đồng)", true),
          f("Ghi chú trình duyệt", "Văn bản dài"),
          file("Hồ sơ trình ngân sách"),
        ],
      },
      {
        kind: "approve",
        id: "p1-gd-ngan-sach",
        name: "4 Giám đốc duyệt ngân sách và phương án",
        group: g("gd"),
        backTo: ["p1-so-sanh"],
      },
      {
        kind: "form",
        id: "p1-po",
        name: "5 Tạo PO – đơn đặt hàng",
        group: g("mh"),
        fields: [
          f("Số PO", "Văn bản ngắn", true),
          f("Giá trị PO", "Số tiền (đồng)"),
          file("Tệp PO"),
        ],
      },
      { kind: "approve", id: "p1-tbp-po", name: "5 Trưởng bộ phận duyệt PO", group: g("tbp") },
      { kind: "finish", id: "p1-xong", name: "Hoàn tất Phần 1" },
    ],
  },
  {
    key: "mua-hang-2-hop-dong",
    name: "Quy trình mua hàng · Phần 2: Hợp đồng",
    description:
      "Dòng 6–7: soạn thảo hợp đồng, Pháp chế → Kế toán → Trưởng bộ phận duyệt lần lượt, Giám đốc (hoặc người được ủy quyền) duyệt, ký số.",
    steps: [
      {
        kind: "form",
        id: "p2-soan-hd",
        name: "6 Soạn thảo hợp đồng",
        group: g("pc"),
        fields: [
          f("Số hợp đồng", "Văn bản ngắn", true),
          f("Nhà cung cấp", "Văn bản ngắn"),
          file("Bản thảo hợp đồng"),
        ],
      },
      { kind: "approve", id: "p2-pc", name: "6 Pháp chế duyệt hợp đồng", group: g("pc") },
      { kind: "approve", id: "p2-kt", name: "6 Kế toán duyệt hợp đồng", group: g("kt") },
      { kind: "approve", id: "p2-tbp", name: "6 Trưởng bộ phận duyệt hợp đồng", group: g("tbp") },
      {
        kind: "approve",
        id: "p2-gd",
        name: "7 Giám đốc (hoặc người được ủy quyền) phê duyệt",
        group: g("gd"),
      },
      { kind: "esign", id: "p2-ky-so", name: "Ký số" },
      { kind: "finish", id: "p2-xong", name: "Hoàn tất Phần 2" },
    ],
  },
  {
    key: "mua-hang-3-nhan-hang-thanh-toan",
    name: "Quy trình mua hàng · Phần 3: Nhận hàng → Thanh toán",
    description:
      "Dòng 8–11: đặt hàng và nhận hàng nghiệm thu, nhận hóa đơn, đề nghị và duyệt thanh toán, thanh toán — hạch toán — lưu hồ sơ.",
    steps: [
      {
        kind: "form",
        id: "p3-nhan-hang",
        name: "8 Đặt hàng, nhận hàng, nghiệm thu",
        group: g("kho"),
        fields: [
          f("Ngày nhận hàng", "Ngày", true),
          f("Số lượng thực nhận", "Số"),
          file("Biên bản nghiệm thu"),
        ],
      },
      {
        kind: "approve",
        id: "p3-tbp-nghiem-thu",
        name: "8 Trưởng bộ phận nghiệm thu",
        group: g("tbp"),
      },
      {
        kind: "approve",
        id: "p3-kho-nghiem-thu",
        name: "8 Quản lý kho xác nhận nhập kho",
        group: g("kho"),
      },
      {
        kind: "form",
        id: "p3-hoa-don",
        name: "9 Nhận hóa đơn từ nhà cung cấp",
        group: g("kt"),
        fields: [
          f("Số hóa đơn", "Văn bản ngắn", true),
          f("Số tiền trên hóa đơn", "Số tiền (đồng)", true),
          file("Tệp hóa đơn"),
        ],
      },
      {
        kind: "form",
        id: "p3-de-nghi-tt",
        name: "10 Lập đề nghị thanh toán",
        group: g("kt"),
        fields: [
          f("Số tiền đề nghị thanh toán", "Số tiền (đồng)", true),
          f("Hạn thanh toán", "Ngày"),
          file("Đề nghị thanh toán"),
        ],
      },
      {
        kind: "approve",
        id: "p3-ktt-tt",
        name: "10 Kế toán trưởng duyệt thanh toán",
        group: g("ktt"),
      },
      {
        kind: "approve",
        id: "p3-gd-tt",
        name: "10 Giám đốc (hoặc người có thẩm quyền) duyệt thanh toán",
        group: g("gd"),
      },
      {
        kind: "form",
        id: "p3-thanh-toan",
        name: "11 Thanh toán, hạch toán, lưu hồ sơ",
        group: g("tq"),
        fields: [f("Ngày chi", "Ngày", true), file("Chứng từ thanh toán"), file("Hồ sơ lưu")],
      },
      {
        kind: "approve",
        id: "p3-ktt-xac-nhan",
        name: "11 Kế toán trưởng xác nhận lưu hồ sơ",
        group: g("ktt"),
      },
      { kind: "finish", id: "p3-xong", name: "Hoàn tất Phần 3" },
    ],
  },
];

/** Mã nhóm dùng trong cả 3 mẫu (không trùng, thứ tự xuất hiện) — khớp `TEMPLATE_GROUPS` của fixture seed. */
export const groupKeysOf = (phases: readonly Phase[] = PHASES): string[] => [
  ...new Set(
    phases.flatMap((p) =>
      p.steps.flatMap((s) => (s.kind === "form" || s.kind === "approve" ? [s.group] : [])),
    ),
  ),
];
