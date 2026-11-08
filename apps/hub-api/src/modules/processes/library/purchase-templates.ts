// CR-125 · cr125-purchase-templates · 3 mẫu Thư viện «Quy trình mua hàng» (Phần 1 Đề xuất → Đặt hàng, Phần 2 Hợp đồng, Phần 3 Nhận hàng →
// Thanh toán). NGUỒN: dựng bằng giao diện quản trị nền tảng (`tools/demo/purchase-templates.ts build`) rồi `export` ra
// `purchase-templates.data.ts`; ở đây chỉ gán id cố định để seed idempotent. Nhóm duyệt/làm theo MÃ (`group_key`): công ty sao chép thì
// mã → nhóm của chính công ty (`mapGroupKey`); mã nhóm khớp `TEMPLATE_GROUPS` của fixture seed (công ty demo đủ nhóm ⇒ `templateReadiness` xanh).
// cr125-purchase-parent: (1) dòng 3 / 6 / 10 duyệt CÙNG LÚC (`after.parallel`, luật `all`) thay vì nối tiếp — gộp các bước Duyệt liền nhau
// của bản xuất UI thành MỘT bước (`mergeParallel`, bước đánh số lại); (2) 3 phần chỉ chạy làm lượt con của «Quy trình mua hàng» (node
// `core.subprocess`): `trigger` = `NEVER_TRIGGER` (bản xuất bản trong DB bắt buộc có «Bắt đầu khi» — `process_defs_published_ck` — nhưng điều kiện
// không bao giờ đúng ⇒ KHÔNG tự mở theo sự kiện HĐ, không tranh quyền duyệt HĐ) và đầu vào do lượt cha đưa (`input_map`).
import { PURCHASE_TEMPLATES_JSON } from "./purchase-templates.data";

export type PurchaseTemplate = {
  id: string;
  key: string;
  name: string;
  description: string;
  input_hint: string;
  inputs: unknown;
  trigger: { event: string; when?: unknown };
  app: string;
  stages: unknown[];
};

/** Id cố định theo thứ tự Phần 1..3, rồi «Quy trình mua hàng» (cha). */
export const PURCHASE_TEMPLATE_IDS = [
  "0c125000-0000-4000-8000-0000000000d1",
  "0c125000-0000-4000-8000-0000000000d2",
  "0c125000-0000-4000-8000-0000000000d3",
] as const;
export const PURCHASE_PARENT_ID = "0c125000-0000-4000-8000-0000000000d0";
export const PURCHASE_PARENT_KEY = "quy-trinh-mua-hang";
export const PURCHASE_PHASE_KEYS = [
  "mua-hang-1-de-xuat-dat-hang",
  "mua-hang-2-hop-dong",
  "mua-hang-3-nhan-hang-thanh-toan",
] as const;

/** Mẫu bắt đầu bằng phiếu / làm lượt con: có «Bắt đầu khi» cho đủ ràng buộc xuất bản nhưng giá trị HĐ < 0 không bao giờ xảy ra. */
export const NEVER_TRIGGER = {
  event: "contract.submitted",
  when: { op: "and", conds: [{ fact: "total_value", op: "lt", value: -1 }] },
} as const;

type Obj = Record<string, unknown>;
type Parallel = { name: string; key: string; of: readonly string[]; labels: readonly string[] };

/** Dòng cùng duyệt theo phần: các bước Duyệt liền nhau (tên bắt đầu bằng `of`) gộp thành một bước, mỗi nhóm một thẻ, luật `all`. */
const PARALLEL_ROWS: readonly (readonly Parallel[])[] = [
  [
    {
      name: "3 Trưởng bộ phận + Tài chính duyệt phương án",
      key: "3-tbp-tai-chinh-duyet-phuong",
      of: ["3 Trưởng bộ phận duyệt phương án", "3 Tài chính duyệt phương án"],
      labels: ["Trưởng bộ phận", "Tài chính"],
    },
  ],
  [
    {
      name: "6 Pháp chế + Kế toán + Trưởng bộ phận duyệt hợp đồng",
      key: "6-phap-che-ke-toan-tbp-duyet",
      of: [
        "6 Pháp chế duyệt hợp đồng",
        "6 Kế toán duyệt hợp đồng",
        "6 Trưởng bộ phận duyệt hợp đồng",
      ],
      labels: ["Pháp chế", "Kế toán", "Trưởng bộ phận"],
    },
  ],
  [
    {
      name: "10 Kế toán trưởng + Người có thẩm quyền duyệt thanh toán",
      key: "10-ke-toan-truong-tham-quyen",
      of: [
        "10 Kế toán trưởng duyệt thanh toán",
        "10 Giám đốc (hoặc người có thẩm quyền) duyệt thanh toán",
      ],
      labels: ["Kế toán trưởng", "Người có thẩm quyền"],
    },
  ],
];

/** Gộp các bước Duyệt liền nhau của `p` thành một bước `after.parallel`; đánh số lại `step`, ánh xạ lại `back_to_steps`. */
export function mergeParallel(stages: readonly Obj[], rows: readonly Parallel[]): Obj[] {
  let out = [...stages];
  for (const p of rows) {
    const at = out.findIndex((s) => s.name === p.of[0]);
    const parts = out.slice(at, at + p.of.length);
    if (at < 0 || !parts.every((s, i) => s.name === p.of[i]))
      throw new Error(`purchase-templates: không thấy các bước «${p.of.join(" + ")}»`);
    const first = parts[0] as Obj;
    const { group_key: _drop, ...after } = first.after as Obj;
    const groups = parts.map((s, i) => ({
      group_key: (s.after as Obj).group_key,
      label: p.labels[i],
    }));
    const merged = {
      ...first,
      key: p.key,
      name: p.name,
      after: { ...after, group_id: null, parallel: { groups, rule: "all" } },
    };
    out = [...out.slice(0, at), merged, ...out.slice(at + parts.length)];
  }
  // Đánh số lại: bước cũ → bước mới (bước gộp lấy số của bước đầu).
  const mergedName = new Map(rows.flatMap((p) => p.of.map((o) => [o, p.name] as const)));
  const oldToNew = new Map(
    stages.map((s) => [
      Number(s.step),
      out.findIndex((x) => x.name === (mergedName.get(String(s.name)) ?? s.name)),
    ]),
  );
  return out.map((s, i) => {
    const after = s.after as Obj;
    const back = Array.isArray(after.back_to_steps) ? (after.back_to_steps as number[]) : [];
    return {
      ...s,
      step: i,
      after: back.length
        ? { ...after, back_to_steps: back.map((b) => oldToNew.get(b) ?? b) }
        : after,
    };
  });
}

/** Phần 1 nhận giá trị phiếu «Đề xuất mua hàng» của lượt cha (`input_map` của node Quy trình con). */
const PHASE1_INPUTS = [
  { key: "noi_dung_can_mua", type: "text", label: "Nội dung cần mua", required: false },
  { key: "so_luong", type: "text", label: "Số lượng", required: false },
  { key: "du_toan", type: "number", label: "Dự toán", required: false },
  { key: "ly_do", type: "text", label: "Lý do", required: false },
];
const CONTRACT_INPUT = [{ key: "contract_id", type: "text", label: "Hợp đồng", required: false }];
const PHASE_INPUTS = [PHASE1_INPUTS, CONTRACT_INPUT, CONTRACT_INPUT];

export const PURCHASE_TEMPLATES: readonly PurchaseTemplate[] = (
  JSON.parse(PURCHASE_TEMPLATES_JSON) as Omit<PurchaseTemplate, "id">[]
).map((t, i) => ({
  ...t,
  id: PURCHASE_TEMPLATE_IDS[i] as string,
  trigger: NEVER_TRIGGER,
  inputs: PHASE_INPUTS[i],
  stages: mergeParallel(t.stages as Obj[], PARALLEL_ROWS[i] ?? []),
}));

const stageBase = (key: string, name: string, step: number, fields: string[] = []) => ({
  key,
  name,
  step,
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "# {name}\n\n## Kết quả\n",
    required_sections: ["Kết quả"],
    fields: fields.map((k) => ({ key: k, type: "string", required: false })),
  },
  autofix: null,
  sources: [],
  answerer: { kind: "starter" },
  must_know: [],
  timeout_s: 600,
  real_action: false,
  token_budget: null,
  after: { kind: "auto", branch: [] },
});

const NO_BUY = 5;
const phaseNode = (step: number, phase: 0 | 1 | 2, extra: Obj = {}) => ({
  ...stageBase(`phan-${phase + 1}`, `Phần ${phase + 1}`, step, ["outcome"]),
  node: "core.subprocess",
  executor: {
    kind: "subprocess",
    def_key: PURCHASE_PHASE_KEYS[phase],
    ...extra,
    branches: [
      { on: "rejected", goto_step: NO_BUY },
      { on: "cancelled", goto_step: NO_BUY },
    ],
  },
});
const endNode = (key: string, name: string, step: number, outcome: string) => ({
  ...stageBase(key, name, step),
  outcome,
  executor: { kind: "set", values: [] },
});

/** «Quy trình mua hàng» (cha): phiếu «Đề xuất mua hàng» (mọi người trong công ty được bắt đầu) → Phần 1 → Phần 2 → Phần 3 → Đã xong; từ chối / huỷ → Không mua. */
export const PURCHASE_PARENT: PurchaseTemplate = {
  id: PURCHASE_PARENT_ID,
  key: PURCHASE_PARENT_KEY,
  name: "Quy trình mua hàng",
  description:
    "Nhân viên gửi phiếu «Đề xuất mua hàng», rồi chạy lần lượt Phần 1 (Đề xuất → Đặt hàng), Phần 2 (Hợp đồng), Phần 3 (Nhận hàng → Thanh toán); một phần bị từ chối thì kết thúc «Không mua».",
  input_hint: "",
  inputs: [],
  trigger: NEVER_TRIGGER,
  app: "contracts",
  stages: [
    {
      ...stageBase("phieu-de-xuat-mua-hang", "Đề xuất mua hàng", 0),
      node: "core.start-form",
      executor: { kind: "set", values: [] },
      start_form: {
        fields: [
          { key: "ten_hang", label: "Tên hàng", type: "text", required: true },
          { key: "so_luong", label: "Số lượng", type: "text", required: false },
          { key: "gia_du_kien", label: "Giá dự kiến", type: "money", required: true },
          { key: "ly_do", label: "Lý do", type: "longtext", required: false },
          { key: "file_bao_gia", label: "File báo giá", type: "attachments", required: false },
        ],
        starters: { kind: "everyone" },
        title_template: "Đề xuất mua {{ten_hang}}",
      },
    },
    phaseNode(1, 0, {
      input_map: {
        noi_dung_can_mua: "ten_hang",
        so_luong: "so_luong",
        du_toan: "gia_du_kien",
        ly_do: "ly_do",
      },
    }),
    phaseNode(2, 1),
    phaseNode(3, 2),
    endNode("da-xong", "Đã xong", 4, "approved"),
    endNode("khong-mua", "Không mua", NO_BUY, "rejected"),
  ],
};
