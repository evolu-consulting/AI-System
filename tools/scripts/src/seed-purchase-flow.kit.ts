// CR-140 · bộ dựng bước + hằng số của «Quy trình mua hàng» (tách khỏi seed-purchase-flow.data.ts cho gọn). KHÔNG I/O.
import {
  approve,
  base,
  out,
  reviewNew,
  type Stage,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";

export const PURCHASE_THRESHOLD_CONTRACT = 20_000_000; // dự toán ≥ mức này ⇒ có bước Hợp đồng (B)
export const PURCHASE_THRESHOLD_DIRECTOR = 500_000_000; // dự toán > mức này ⇒ Giám đốc duyệt ngân sách

export const NAMES = {
  parent: "Mua hàng",
  a: "Mua hàng · A Chọn nhà cung cấp và ngân sách",
  b: "Mua hàng · B Hợp đồng",
  c: "Mua hàng · C Nhận hàng và thanh toán",
} as const;

/** Mã nhóm dùng trong quy trình: phòng ban (`pb-*`, nguồn `deploy/tenants/demo.yaml`) + nhóm vai. */
export const G = {
  giamDoc: "pb-giam-doc",
  muaHang: "pb-mua-hang",
  keToan: "pb-ke-toan",
  phapChe: "pb-phap-che",
  kho: "pb-kho-van",
  taiChinh: "tai-chinh",
  thuQuy: "thu-quy",
  ktThanhToan: "ke-toan-thanh-toan",
} as const;

/** Luật không bao giờ đúng: quy trình chỉ mở bằng phiếu (cha) hoặc làm lượt con — không tranh quyền duyệt HĐ (như mẫu Thư viện CR-125). */
export const NEVER_TRIGGER = {
  event: "contract.submitted",
  when: { op: "and", conds: [{ fact: "total_value", op: "lt", value: -1 }] },
} as const;

// ── ô của «Bước làm việc» ──
export type FieldType = "text" | "textarea" | "money" | "date" | "file_ref";
export type Field = { key: string; label: string; type: FieldType; required?: boolean };
const OUT_TYPE = {
  text: "string",
  textarea: "string",
  money: "number",
  date: "date",
  file_ref: "string",
};
const fieldDef = (f: Field) => ({
  key: f.key,
  label: f.label,
  type: f.type,
  required: f.required ?? false,
  ...(f.type === "text" ? { max_len: 200 } : f.type === "textarea" ? { max_len: 2000 } : {}),
  ...(f.type === "money" ? { min: 0 } : {}),
});
export const txt = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "text",
  required,
});
export const money = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "money",
  required,
});
export const file = (key: string, label: string): Field => ({ key, label, type: "file_ref" });
export const date = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "date",
  required,
});
export const note = (key: string, label: string): Field => ({ key, label, type: "textarea" });

/** «Bước làm việc»: một nhóm điền form (`also` = nhóm khác cũng được làm). */
export function work(
  key: string,
  name: string,
  step: number,
  group: string,
  fields: Field[],
  also: string[] = [],
): Stage {
  return {
    ...base,
    key,
    name,
    step,
    executor: { kind: "form", fields: fields.map(fieldDef) },
    output: out(
      `${key}.md`,
      fields.map((f) => ({ key: f.key, type: OUT_TYPE[f.type], required: false })),
    ),
    after: {
      ...reviewNew(group),
      exclude_starter: false,
      ...(also.length ? { also_group_keys: also } : {}),
    },
  };
}

export type To = { reject: number; ret: number };
/** Duyệt bởi TRƯỞNG phòng `dept` (`head_only` + Cần «trưởng phòng»). */
export const headOf = (
  key: string,
  name: string,
  step: number,
  dept: string,
  to: To,
  o: Stage = {},
): Stage =>
  approve(key, name, step, dept, to, {
    after: { ...reviewNew(dept), head_only: true, need: "head" },
    ...o,
  });
/** Duyệt bởi trưởng phòng CỦA NGƯỜI ĐỀ XUẤT (`approver_mode: starter_head`, không chọn nhóm). */
export function starterHead(key: string, name: string, step: number, to: To): Stage {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return approve(key, name, step, "", to, { after: { ...after, approver_mode: "starter_head" } });
}
/** Duyệt song song «tất cả»: mỗi nhóm một thẻ cùng lúc; nhánh `"head"` ⇒ chỉ trưởng phòng nhóm đó (`head_only`, CR-140). */
export function allOf(
  key: string,
  name: string,
  step: number,
  groups: [string, string, "head"?][],
  to: To,
): Stage {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return approve(key, name, step, "", to, {
    after: {
      ...after,
      group_id: null,
      parallel: {
        groups: groups.map(([group_key, label, head]) => ({
          group_key,
          label,
          ...(head ? { head_only: true } : {}),
        })),
        rule: "all",
      },
    },
  });
}
export const ifInput = (
  key: string,
  name: string,
  step: number,
  input: string,
  op: "gt" | "ge",
  v: number,
  then: number,
  otherwise: number,
): Stage => ({
  ...base,
  key,
  name,
  step,
  executor: {
    kind: "if",
    when: { op: "and", conds: [{ from: { kind: "input", key: input }, op, value: v }] },
    then_step: then,
    else_step: otherwise,
  },
  output: out(`${key}.md`),
  after: { kind: "auto", branch: [] },
});
