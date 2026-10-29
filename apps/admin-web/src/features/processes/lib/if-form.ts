// CR-103 · fnr-if (flow-node-registry design §3): bản nháp khối "Nếu" (node If) của editor — đổi qua lại với contract `IfExecutor`
// (bước UI đếm từ 1, `then_step = then - 1`), nguồn điều kiện mã hoá một chuỗi cho ô chọn. Hàm thuần (không React, không API).
import type { Cond, IfExecutor } from "@ai/contracts/hub-admin";
import type { FieldDraft } from "./draft-types";

export const IF_CONDS_MAX = 6;
/** Nguồn một điều kiện: `field|<stage_key>|<field>` hoặc `input|<key>`; rỗng = chưa chọn. */
export type CondDraft = { from: string; op: string; value: string };
export type IfDraft = {
  op: "and" | "or";
  conds: CondDraft[];
  /** Bước Đúng (`yes`) / Sai (`no`) đếm từ 1; `no = null` ⇒ Sai thì sang bước kế; `yes = null` = chưa chọn. */
  yes: number | null;
  no: number | null;
};
/** Nguồn chọn được: stage (bước nhỏ hơn) có field khai báo + input của quy trình. */
export type CondSource = { value: string; type: FieldDraft["type"]; label: string };

export const emptyCond = (): CondDraft => ({ from: "", op: "eq", value: "" });
export const emptyIf = (): IfDraft => ({ op: "and", conds: [emptyCond()], yes: null, no: null });

export const fieldSrc = (stageKey: string, field: string) => `field|${stageKey}|${field}`;
export const inputSrc = (key: string) => `input|${key}`;

export function parseSrc(s: string): Cond["from"] | null {
  const [kind, a, b] = s.split("|");
  if (kind === "field" && a && b) return { kind: "field", stage_key: a, field: b };
  if (kind === "input" && a) return { kind: "input", key: a };
  return null;
}
const srcOf = (f: Cond["from"]) =>
  f.kind === "field" ? fieldSrc(f.stage_key, f.field) : inputSrc(f.key);

/** Nguồn chọn được cho stage ở bước `step`: field của stage ở bước nhỏ hơn + input khai báo. */
export function condSources(
  stages: readonly { key: string; step: number; fields: readonly FieldDraft[] }[],
  inputs: readonly { key: string; type: string }[],
  step: number,
): CondSource[] {
  const asType = (t: string): FieldDraft["type"] => (t === "number" || t === "date" ? t : "string");
  return [
    ...stages
      .filter((s) => s.step < step)
      .flatMap((s) =>
        s.fields.map((f) => ({
          value: fieldSrc(s.key, f.key),
          type: f.type,
          label: `${s.key}.${f.key}`,
        })),
      ),
    ...inputs
      .filter((i) => i.key !== "")
      .map((i) => ({ value: inputSrc(i.key), type: asType(i.type), label: i.key })),
  ];
}

/** Bản nháp → executor contract. Nguồn/đích chưa chọn ⇒ nguồn rỗng / `then_step = -1` (bị `ifDefIssues` bắt). */
export function draftToIf(d: IfDraft, sources: readonly CondSource[]): IfExecutor {
  return {
    kind: "if",
    when: {
      op: d.op,
      conds: d.conds.map((c) => {
        const type = sources.find((s) => s.value === c.from)?.type;
        const value: string | number =
          type === "number" ? (c.value.trim() === "" ? Number.NaN : Number(c.value)) : c.value;
        return {
          from: parseSrc(c.from) ?? { kind: "input", key: "" },
          op: c.op as Cond["op"],
          value,
        };
      }),
    },
    then_step: d.yes === null ? -1 : d.yes - 1,
    else_step: d.no === null ? null : d.no - 1,
  };
}

export function ifToDraft(e: IfExecutor): IfDraft {
  return {
    op: e.when.op,
    conds: e.when.conds.map((c) => ({ from: srcOf(c.from), op: c.op, value: String(c.value) })),
    yes: e.then_step + 1,
    no: e.else_step === null ? null : e.else_step + 1,
  };
}

/** Bước đích chọn được (0-based, sau `step`, trước `stepCount`) — dùng lại `gotoSteps` của rẽ nhánh. */
export function ifErrorAt(
  errors: Record<string, string>,
  i: number,
  cell?:
    | "then_step"
    | "else_step"
    | `when.conds.${number}.${"from" | "op" | "value"}`
    | "when.conds",
): string | undefined {
  return errors[cell ? `stages.${i}.executor.${cell}` : `stages.${i}.executor`];
}
