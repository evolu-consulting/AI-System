// CR-140 · dữ liệu + luật thuần của `bun run demo:purchase`: «Quy trình mua hàng» 11 bước = 1 cha + 3 con, dựng cho công ty mẫu `demo`.
// KHÔNG I/O. Người duyệt/làm theo SƠ ĐỒ TỔ CHỨC của `deploy/tenants/demo.yaml` (mã nhóm = mã phòng ban `pb-*`) + 4 nhóm vai
// (`tai-chinh`, `thu-quy`, `ke-toan-thanh-toan`, `nguoi-ky-hd`) — không tạo nhóm trùng phòng ban (luật gốc 1).
//   Cha  «Mua hàng»      : Phiếu yêu cầu → A → (dự toán ≥ 20 triệu ⇒ B, không thì bỏ) → C → Kết thúc.
//   A    «Chọn NCC & ngân sách» (bước 1–5) · B «Hợp đồng» (bước 6–7) · C «Nhận hàng & thanh toán» (bước 8–11).
import {
  approve,
  base,
  finish,
  norm,
  out,
  reviewNew,
  type Stage,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import {
  allOf,
  date,
  file,
  G,
  headOf,
  ifInput,
  money,
  NAMES,
  NEVER_TRIGGER,
  note,
  PURCHASE_THRESHOLD_CONTRACT,
  PURCHASE_THRESHOLD_DIRECTOR,
  starterHead,
  txt,
  work,
} from "./seed-purchase-flow.kit";

export { G, NAMES, NEVER_TRIGGER, PURCHASE_THRESHOLD_CONTRACT, PURCHASE_THRESHOLD_DIRECTOR };

// ── A · Chọn NCC & ngân sách (bước 1–5) ──
export const A_INPUTS = [
  { key: "ten_hang", label: "Tên hàng", type: "text", required: false },
  { key: "so_luong", label: "Số lượng", type: "text", required: false },
  { key: "du_toan", label: "Dự toán", type: "number", required: false },
  { key: "ly_do", label: "Lý do", type: "text", required: false },
];
export function stagesA(): unknown[] {
  const to = { reject: 12, ret: 13 };
  return norm([
    starterHead("1-truong-phong-duyet", "1 Trưởng phòng đề xuất duyệt", 0, to),
    work("2-bao-gia", "2 Tìm nhà cung cấp, lấy báo giá", 1, G.muaHang, [
      txt("ncc_bao_gia", "Nhà cung cấp", true),
      money("gia_bao_gia", "Giá báo (đồng)"),
      file("tep_bao_gia", "Tệp báo giá"),
    ]),
    headOf("2-tp-mua-hang-duyet", "2 Trưởng phòng Mua hàng duyệt báo giá", 2, G.muaHang, to),
    work("3-so-sanh", "3 Lập bảng so sánh giá, đề xuất nhà cung cấp", 3, G.muaHang, [
      txt("ncc_de_xuat", "Nhà cung cấp đề xuất", true),
      money("gia_de_xuat", "Giá đề xuất (đồng)"),
      file("bang_so_sanh", "Bảng so sánh"),
    ]),
    allOf(
      "3-duyet-phuong-an",
      "3 Mua hàng + Tài chính duyệt phương án",
      4,
      [
        [G.muaHang, "Phòng Mua hàng", "head"],
        [G.taiChinh, "Tài chính"],
      ],
      to,
    ),
    work("4-ngan-sach", "4 Kế toán quản trị lập phương án ngân sách", 5, G.taiChinh, [
      money("ngan_sach", "Ngân sách đề xuất (đồng)", true),
      note("phuong_an", "Phương án ngân sách"),
    ]),
    ifInput(
      "4-re-nhanh",
      "Dự toán trên 500 triệu?",
      6,
      "du_toan",
      "gt",
      PURCHASE_THRESHOLD_DIRECTOR,
      7,
      8,
    ),
    approve("4-giam-doc-duyet", "4 Giám đốc duyệt ngân sách", 7, G.giamDoc, to, {
      next_step: 9,
      after: { ...reviewNew(G.giamDoc), head_only: true, need: "head" },
    }),
    headOf("4-tp-mua-hang-duyet", "4 Trưởng phòng Mua hàng duyệt ngân sách", 8, G.muaHang, to),
    work("5-po", "5 Tạo PO – đơn đặt hàng", 9, G.muaHang, [
      txt("so_po", "Số PO", true),
      money("gia_tri_po", "Giá trị PO (đồng)"),
      file("file_po", "Tệp PO"),
    ]),
    headOf("5-tp-mua-hang-duyet", "5 Trưởng phòng Mua hàng duyệt PO", 10, G.muaHang, to),
    finish(11, "approved", "Đã duyệt"),
    finish(12, "rejected", "Từ chối"),
    finish(13, "returned", "Trả lại"),
  ]);
}

// ── B · Hợp đồng (bước 6–7) ──
export const B_INPUTS = [
  { key: "hd_ten", label: "Tên hợp đồng", type: "text", required: false },
  { key: "hd_doi_tac", label: "Đối tác", type: "text", required: false },
  { key: "hd_gia_tri", label: "Giá trị hợp đồng", type: "number", required: false },
];
export function stagesB(): unknown[] {
  const to = { reject: 5, ret: 6 };
  const create: Stage = {
    ...base,
    key: "6-tao-hd",
    name: "6 Tạo hợp đồng từ hồ sơ",
    node: "contracts.create-from-step",
    step: 1,
    executor: {
      kind: "tool",
      tool_key: "contracts-create-from-step",
      args: {
        file_id: { from: "field", stage_key: "6-soan-hd", field: "file_id" },
        title: { from: "input", key: "hd_ten" },
        counterparty: { from: "input", key: "hd_doi_tac" },
        amount: { from: "input", key: "hd_gia_tri" },
      },
    },
    output: out("6-tao-hd.md", [{ key: "contract_id", type: "string", required: true }]),
    after: { kind: "auto", branch: [] },
  };
  return norm([
    // Tệp hợp đồng phải gắn vào CHÍNH lượt B (engine: tệp của lượt con A không đi sang lượt con B) ⇒ Pháp chế soạn / tải bản thảo ở đây.
    work("6-soan-hd", "6 Pháp chế soạn hợp đồng", 0, G.phapChe, [
      txt("so_hop_dong", "Số hợp đồng", true),
      file("file_id", "Tệp hợp đồng (bản thảo)"),
    ]),
    create,
    allOf(
      "6-duyet-hd",
      "6 Pháp chế + Kế toán + Mua hàng duyệt hợp đồng",
      2,
      [
        [G.phapChe, "Pháp chế"],
        [G.keToan, "Kế toán", "head"],
        [G.muaHang, "Phòng Mua hàng", "head"],
      ],
      to,
    ),
    approve("7-giam-doc-duyet", "7 Giám đốc duyệt hợp đồng", 3, G.giamDoc, to, {
      after: { ...reviewNew(G.giamDoc), head_only: true, need: "head" },
    }),
    // Ký số: chỉ khi công ty bật ký số (demo chưa cấu hình nhà cung cấp) ⇒ nhánh bỏ ký số; bật rồi thì thêm node Ký số trước bước kết thúc.
    finish(4, "approved", "Đã duyệt"),
    finish(5, "rejected", "Từ chối"),
    finish(6, "returned", "Trả lại"),
  ]);
}

// ── C · Nhận hàng & thanh toán (bước 8–11) ──
export const C_INPUTS = [
  { key: "contract_id", label: "Hợp đồng", type: "text", required: false },
  { key: "ten_hang", label: "Tên hàng", type: "text", required: false },
  { key: "du_toan", label: "Dự toán", type: "number", required: false },
];
export function stagesC(): unknown[] {
  const to = { reject: 9, ret: 10 };
  return norm([
    work("8-nhan-hang", "8 Nhận hàng, nghiệm thu, biên bản", 0, G.kho, [
      date("ngay_nhan", "Ngày nhận hàng", true),
      txt("so_luong_nhan", "Số lượng thực nhận"),
      file("bien_ban", "Biên bản nghiệm thu"),
    ]),
    headOf("8-tp-kho-duyet", "8 Trưởng phòng Kho duyệt nghiệm thu", 1, G.kho, to),
    work("9-hoa-don", "9 Kế toán mua hàng kiểm hoá đơn", 2, G.ktThanhToan, [
      txt("so_hoa_don", "Số hoá đơn", true),
      money("so_tien_hd", "Số tiền trên hoá đơn (đồng)"),
      file("file_hoa_don", "Tệp hoá đơn"),
    ]),
    headOf("9-ktt-duyet", "9 Kế toán trưởng duyệt hoá đơn", 3, G.keToan, to),
    work("10-de-nghi-tt", "10 Kế toán thanh toán đề nghị thanh toán", 4, G.ktThanhToan, [
      money("so_tien_tt", "Số tiền đề nghị thanh toán (đồng)", true),
      note("ghi_chu_tt", "Ghi chú"),
    ]),
    allOf(
      "10-duyet-tt",
      "10 Kế toán trưởng + Giám đốc duyệt thanh toán",
      5,
      [
        [G.keToan, "Kế toán", "head"],
        [G.giamDoc, "Giám đốc", "head"],
      ],
      to,
    ),
    work(
      "11-thanh-toan",
      "11 Thanh toán, hạch toán",
      6,
      G.thuQuy,
      [date("ngay_chi", "Ngày chi", true), file("chung_tu", "Chứng từ thanh toán / hạch toán")],
      [G.ktThanhToan],
    ),
    headOf("11-ktt-duyet", "11 Kế toán trưởng duyệt hạch toán", 7, G.keToan, to),
    finish(8, "approved", "Đã duyệt"),
    finish(9, "rejected", "Từ chối"),
    finish(10, "returned", "Trả lại"),
  ]);
}

// ── Cha «Mua hàng» ──
const stageBase = (key: string, name: string, step: number, fields: string[] = []): Stage => ({
  ...base,
  key,
  name,
  step,
  timeout_s: 600,
  output: out(
    `${key}.md`,
    fields.map((k) => ({ key: k, type: "string", required: false })),
  ),
  after: { kind: "auto", branch: [] },
});
const NO_BUY = 6;
const phase = (
  step: number,
  key: string,
  defKey: string,
  inputMap: Record<string, string>,
): Stage => ({
  ...stageBase(
    key,
    key === "phan-1"
      ? "A Chọn nhà cung cấp và ngân sách"
      : key === "phan-2"
        ? "B Hợp đồng"
        : "C Nhận hàng và thanh toán",
    step,
    ["outcome"],
  ),
  node: "core.subprocess",
  executor: {
    kind: "subprocess",
    def_key: defKey,
    input_map: inputMap,
    branches: [
      { on: "rejected", goto_step: NO_BUY },
      { on: "cancelled", goto_step: NO_BUY },
    ],
  },
});

export const PARENT_FORM = {
  fields: [
    { key: "ten_hang", label: "Tên hàng", type: "text", required: true },
    { key: "so_luong", label: "Số lượng", type: "text", required: false },
    { key: "du_toan", label: "Dự toán (đồng)", type: "money", required: true },
    { key: "ly_do", label: "Lý do mua", type: "longtext", required: false },
    { key: "tep_dinh_kem", label: "Tệp đính kèm", type: "attachments", required: false },
  ],
  starters: { kind: "everyone" },
  title_template: "Mua {{ten_hang}}",
};

/** Cha: Phiếu → A → Nếu dự toán ≥ 20 triệu (⇒ B, không thì bỏ) → C → Đã xong; một phần bị từ chối / huỷ ⇒ Không mua. `keys` = mã quy trình con A/B/C. */
export function stagesParent(keys: { a: string; b: string; c: string }): unknown[] {
  return norm([
    {
      ...stageBase("phieu-mua-hang", "Phiếu yêu cầu mua hàng", 0),
      node: "core.start-form",
      executor: { kind: "set", values: [] },
      start_form: PARENT_FORM,
    },
    phase(1, "phan-1", keys.a, {
      ten_hang: "ten_hang",
      so_luong: "so_luong",
      du_toan: "du_toan",
      ly_do: "ly_do",
    }),
    ifInput(
      "re-hop-dong",
      "Dự toán từ 20 triệu?",
      2,
      "du_toan",
      "ge",
      PURCHASE_THRESHOLD_CONTRACT,
      3,
      4,
    ),
    phase(3, "phan-2", keys.b, {
      hd_ten: "ten_hang",
      hd_doi_tac: "phan-1:sub_ncc_de_xuat",
      hd_gia_tri: "phan-1:sub_gia_tri_po",
    }),
    phase(4, "phan-3", keys.c, {
      contract_id: "phan-2:sub_contract_id",
      ten_hang: "ten_hang",
      du_toan: "du_toan",
    }),
    { ...finish(5, "approved", "Đã xong"), key: "da-xong", name: "Đã xong" },
    { ...finish(NO_BUY, "rejected", "Không mua"), key: "khong-mua", name: "Không mua" },
  ]);
}

/** Bốn quy trình (con trước, cha sau — cha cần mã quy trình con). */
export const PURCHASE_FLOWS = [
  { name: NAMES.a, inputs: A_INPUTS, stages: stagesA },
  { name: NAMES.b, inputs: B_INPUTS, stages: stagesB },
  { name: NAMES.c, inputs: C_INPUTS, stages: stagesC },
] as const;

/** Mã nhóm quy trình dùng (kiểm: mỗi mã có ở công ty `demo`). THUẦN. */
export function groupKeysOf(stages: readonly unknown[]): string[] {
  const keys = new Set<string>();
  for (const s of stages as { after?: Record<string, unknown> }[]) {
    const a = s.after ?? {};
    if (typeof a.group_key === "string") keys.add(a.group_key);
    for (const k of (a.also_group_keys as string[] | undefined) ?? []) keys.add(k);
    for (const g of (a.parallel as { groups: { group_key: string }[] } | undefined)?.groups ?? [])
      keys.add(g.group_key);
  }
  return [...keys].sort();
}

/** Đầu vào của lượt cha = các ô của phiếu (node Nếu đọc `du_toan` như đầu vào kiểu số). */
export const PARENT_INPUTS = [
  { key: "du_toan", label: "Dự toán", type: "number", required: false },
];
