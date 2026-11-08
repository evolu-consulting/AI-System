// CR-125 · quy trình MUA HÀNG 11 bước dưới dạng FlowDef (cùng hình `ProcessStageDef` mà trình sửa canvas lưu).
// Việc = node «Điền thông tin» (form, nhóm làm); duyệt = node «Duyệt» (nhóm duyệt). «A + B» duyệt = hai node Duyệt nối tiếp
// (engine chưa có duyệt song song / đủ-cả-hai — xem docs/specs/CR-125/purchase-flow-trial.md). Ký số = node bảng `contracts.esign`.
import { ROLES } from "./purchase-flow-data";

type Json = Record<string, unknown>;
const G = (r: keyof typeof ROLES): string => ROLES[r].group;

const base = (key: string, name: string, step: number): Json => ({
  key,
  name,
  step,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
});
const auto = { kind: "auto", branch: [] };
const review = (group: string, also: string[] = [], back: number[] = []): Json => ({
  kind: "review",
  group_id: null,
  group_key: group,
  ...(also.length ? { also_group_keys: also } : {}),
  back_to_steps: back,
  remind_every_h: 24,
  escalate: null,
  branch: [],
  exclude_starter: false,
});

type Field = { key: string; label: string; type: string; required?: boolean };
const TYPE_OUT: Record<string, string> = {
  text: "string",
  textarea: "string",
  number: "number",
  money: "number",
  date: "date",
  select: "string",
  checkbox: "string",
  file_ref: "string",
};
const fieldDef = (f: Field): Json => ({
  key: f.key,
  label: f.label,
  type: f.type,
  required: f.required ?? false,
  ...(f.type === "text"
    ? { max_len: 200 }
    : f.type === "textarea"
      ? { max_len: 2000 }
      : f.type === "money"
        ? { min: 0 }
        : f.type === "number"
          ? { integer: false }
          : {}),
});

/** Việc «làm»: form do `group` (+ `also`) điền. */
export const work = (
  key: string,
  name: string,
  step: number,
  group: string,
  fields: Field[],
  also: string[] = [],
): Json => ({
  ...base(key, name, step),
  executor: { kind: "form", fields: fields.map(fieldDef) },
  output: {
    filename: `${key}.md`,
    template: "x",
    required_sections: ["x"],
    fields: fields.map((f) => ({ key: f.key, type: TYPE_OUT[f.type], required: false })),
  },
  after: review(group, also),
});

/** Duyệt: `group` (+ `also` = nhóm khác cũng quyết). Từ chối → `reject`; Trả lại → `ret` (hoặc về bước `back` nếu `ret` = null). */
export const approve = (
  key: string,
  name: string,
  step: number,
  group: string,
  o: { reject?: number | null; ret?: number | null; back?: number[]; also?: string[] },
): Json => ({
  ...base(key, name, step),
  executor: { kind: "approve", reject_step: o.reject ?? null, return_step: o.ret ?? null },
  after: review(group, o.also ?? [], o.back ?? []),
});

const finish = (key: string, name: string, step: number, outcome: string): Json => ({
  ...base(key, name, step),
  executor: { kind: "set", values: [] },
  after: auto,
  outcome,
});

/**
 * 20 bước (trần cứng `FLOW_STEPS_MAX` = 20): mỗi dòng của bảng = «Điền thông tin» (nhóm làm) rồi «Duyệt» (nhóm duyệt);
 * dòng 9 + 10 gộp một form, dòng 11 bỏ bước duyệt cuối, «A + B» duyệt = một node + nhóm phụ (một-trong-hai, KHÔNG đủ-cả-hai).
 * Từ chối = null (kết thúc lượt, hành vi cổng cũ). Duyệt ngân sách (dòng 4): «Trả lại» quay về form so sánh giá (dòng 3).
 */
export function purchaseStages(signerGroupId?: string): {
  stages: Json[];
  index: Record<string, number>;
} {
  type Mk = (i: number, at: (id: string) => number) => Json;
  const L: { id: string; mk: Mk }[] = [];
  const add = (id: string, mk: Mk) => L.push({ id, mk });
  const money = (key: string, label: string, required = false): Field => ({
    key,
    label,
    type: "money",
    required,
  });
  const file = (key: string, label: string): Field => ({ key, label, type: "file_ref" });
  const txt = (key: string, label: string, required = false): Field => ({
    key,
    label,
    type: "text",
    required,
  });
  add("s1", (i) =>
    work("s1-de-xuat", "1 Đề xuất nhu cầu mua", i, G("nv"), [
      txt("noi_dung", "Nội dung cần mua", true),
      { key: "so_luong", label: "Số lượng", type: "number" },
      money("du_toan", "Dự toán (đồng)"),
      file("tai_lieu", "Tài liệu đính kèm"),
    ]),
  );
  add("s1a", (i) => approve("s1-tbp", "1 Trưởng bộ phận duyệt đề xuất", i, G("tbp"), {}));
  add("s2", (i) =>
    work("s2-bao-gia", "2 Tìm nhà cung cấp, lấy báo giá", i, G("mh"), [
      txt("nha_cung_cap", "Nhà cung cấp", true),
      money("bao_gia", "Giá báo (đồng)"),
      file("file_bao_gia", "Tệp báo giá"),
    ]),
  );
  add("s2a", (i) => approve("s2-tmh", "2 Trưởng mua hàng duyệt báo giá", i, G("tmh"), {}));
  add("s3", (i) =>
    work("s3-so-sanh", "3 Lập bảng so sánh giá, đề xuất chọn", i, G("mh"), [
      txt("ncc_de_xuat", "Nhà cung cấp đề xuất", true),
      money("gia_de_xuat", "Giá đề xuất (đồng)"),
      file("bang_so_sanh", "Bảng so sánh"),
    ]),
  );
  add("s3a", (i) =>
    approve("s3-tbp-tc", "3 Trưởng bộ phận / Tài chính duyệt", i, G("tbp"), { also: [G("tc")] }),
  );
  add("s4a", (i, at) =>
    approve("s4-gd", "4 Giám đốc duyệt ngân sách và phương án", i, G("gd"), { back: [at("s3")] }),
  );
  add("s5", (i) =>
    work("s5-po", "5 Tạo PO – đơn đặt hàng", i, G("mh"), [
      txt("so_po", "Số PO", true),
      money("gia_tri_po", "Giá trị PO (đồng)"),
      file("file_po", "Tệp PO"),
    ]),
  );
  add("s5a", (i) => approve("s5-tbp", "5 Trưởng bộ phận duyệt PO", i, G("tbp"), {}));
  add("s6", (i) =>
    work(
      "s6-soan-hd",
      "6 Soạn thảo hợp đồng",
      i,
      G("pc"),
      [txt("so_hop_dong", "Số hợp đồng", true), file("file_hop_dong", "Tệp hợp đồng")],
      [G("mh")],
    ),
  );
  add("s6a", (i) =>
    approve("s6-pc-kt-tbp", "6 Pháp chế / Kế toán / Trưởng bộ phận duyệt HĐ", i, G("pc"), {
      also: [G("kt"), G("tbp")],
    }),
  );
  add("s7a", (i) => approve("s7-gd", "7 Giám đốc / người được ủy quyền phê duyệt", i, G("gd"), {}));
  add("s7-esign", (i) => ({
    ...base("ky-so", "7 Ký số hợp đồng", i),
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: {
        contract_id: { key: "contract_id", from: "input" },
        partner_signs: { from: "const", value: false },
        ...(signerGroupId
          ? { company_signers: { from: "const", value: `group:${signerGroupId}` } }
          : {}),
      },
    },
    real_action: true,
    after: auto,
    node: "contracts.esign",
  }));
  add("s7-wait", (i, at) => ({
    ...base("cho-ky", "7 Chờ ký xong", i),
    executor: {
      kind: "wait_event",
      event: "esign.completed",
      also_events: ["esign.declined", "esign.voided"],
      timeout_h: 168,
      branches: [
        { on: "esign.declined", goto_step: at("end") },
        { on: "esign.voided", goto_step: at("end") },
        { on: "timeout", goto_step: at("end") },
      ],
    },
    after: auto,
    node: "contracts.esign",
  }));
  add("s8", (i) =>
    work(
      "s8-nhan-hang",
      "8 Đặt hàng, nhận hàng, nghiệm thu",
      i,
      G("mh"),
      [
        { key: "ngay_nhan", label: "Ngày nhận hàng", type: "date" },
        { key: "so_luong_nhan", label: "Số lượng thực nhận", type: "number" },
        file("bien_ban", "Biên bản nghiệm thu"),
      ],
      [G("kho")],
    ),
  );
  add("s8a", (i) =>
    approve("s8-tbp-kho", "8 Trưởng bộ phận / Quản lý kho nghiệm thu", i, G("tbp"), {
      also: [G("kho")],
    }),
  );
  add("s9", (i) =>
    work("s9-hoa-don", "9–10 Nhận hóa đơn và đề nghị thanh toán", i, G("kt"), [
      txt("so_hoa_don", "Số hóa đơn", true),
      money("so_tien_tt", "Số tiền đề nghị thanh toán (đồng)", true),
      file("file_hoa_don", "Tệp hóa đơn"),
    ]),
  );
  add("s9a", (i) =>
    approve("s9-ktt-gd", "9–10 Kế toán trưởng / Người có thẩm quyền duyệt", i, G("ktt"), {
      also: [G("gd")],
    }),
  );
  add("s11", (i) =>
    work(
      "s11-thanh-toan",
      "11 Thanh toán, hạch toán, lưu hồ sơ",
      i,
      G("tq"),
      [
        { key: "ngay_chi", label: "Ngày chi", type: "date", required: true },
        file("chung_tu", "Chứng từ thanh toán"),
      ],
      [G("kt")],
    ),
  );
  add("end", (i) => finish("ket-thuc-approved", "Kết thúc · Đã duyệt (lưu hồ sơ)", i, "approved"));
  const at = (id: string): number => L.findIndex((x) => x.id === id);
  const stages = L.map((x, i) => {
    const s = x.mk(i, at);
    const ex = s.executor as { kind: string };
    const af = s.after as { back_to_steps?: number[] };
    if (ex.kind === "approve" && af.back_to_steps?.length === 0) af.back_to_steps = [];
    return s;
  });
  const index: Record<string, number> = {};
  for (const s of stages) index[s.key as string] = s.step as number;
  return { stages, index };
}
