// CR-103 · fnr-if (flow-node-registry design §3): bản nháp khối "Nếu" (node If) của editor — đổi qua lại với contract `IfExecutor`
// (bước UI đếm từ 1, `then_step = then - 1`), nguồn điều kiện mã hoá một chuỗi cho ô chọn. Hàm thuần (không React, không API).
import { type Cond, canonicalCondValue, type IfExecutor } from "@ai/contracts/hub-admin";
import { emptyAutofix } from "./autofix-form";
import type { CondDraft, FieldDraft, IfDraft, StageDraft } from "./draft-types";

export const IF_CONDS_MAX = 6;
// CR-105 · kiểu CondDraft/IfDraft đặt ở `draft-types` (phá vòng draft-types ↔ if-form); re-export cho nơi dùng cũ.
export type { CondDraft, IfDraft } from "./draft-types";
/** Nguồn chọn được: stage (bước nhỏ hơn) có field khai báo + input của quy trình. */
/** `boolean` (Có/Không) chỉ có ở dữ kiện của sự kiện: chọn Có/Không thay vì gõ chữ; lưu là boolean thật (u15). */
export type CondSource = { value: string; type: FieldDraft["type"] | "boolean"; label: string };

export const emptyCond = (): CondDraft => ({ from: "", type: "string", op: "eq", value: "" });
export const emptyIf = (): IfDraft => ({ op: "and", conds: [emptyCond()], yes: null, no: null });

export const fieldSrc = (stageKey: string, field: string) => `field|${stageKey}|${field}`;
export const inputSrc = (key: string) => `input|${key}`;

/** CR-122 · nguồn dữ kiện HIỆN TẠI của bản ghi (app khai ở `AppEventDecl.facts`). */
export const factSrc = (key: string) => `fact|${key}`;

export function parseSrc(s: string): Cond["from"] | null {
  const [kind, a, b] = s.split("|");
  if (kind === "field" && a && b) return { kind: "field", stage_key: a, field: b };
  if (kind === "input" && a) return { kind: "input", key: a };
  if (kind === "fact" && a) return { kind: "fact", key: a };
  return null;
}
const srcOf = (f: Cond["from"]) =>
  f.kind === "field"
    ? fieldSrc(f.stage_key, f.field)
    : f.kind === "fact"
      ? factSrc(f.key)
      : inputSrc(f.key);

/** Dữ kiện của sự kiện → nguồn chọn được trong node Nếu (kiểu số/ngày giữ, còn lại so chuỗi). */
export function factSources(
  facts: readonly { key: string; label: string; type: string }[],
): CondSource[] {
  return facts.map((f) => ({
    value: factSrc(f.key),
    type: f.type === "number" || f.type === "date" || f.type === "boolean" ? f.type : "string",
    label: f.label,
  }));
}

/** Nguồn chọn được cho stage ở bước `step`: field của stage ở bước nhỏ hơn + input khai báo. */
export function condSources(
  stages: readonly {
    key: string;
    step: number;
    fields: readonly FieldDraft[];
    executor?: string;
  }[],
  inputs: readonly { key: string; type: string }[],
  step: number,
): CondSource[] {
  const asType = (t: string): FieldDraft["type"] => (t === "number" || t === "date" ? t : "string");
  // CR-122 · bước chờ sự kiện luôn ghi field `event` (khoá sự kiện đã nhận / `timeout`) ⇒ Nếu rẽ theo đó được.
  const withEvent = (s: (typeof stages)[number]): readonly FieldDraft[] =>
    s.executor === "wait_event" && !s.fields.some((f) => f.key === "event")
      ? [...s.fields, { key: "event", type: "string", required: false }]
      : s.fields;
  return [
    ...stages
      .filter((s) => s.step < step)
      .flatMap((s) =>
        withEvent(s).map((f) => ({
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
export function draftToIf(d: IfDraft): IfExecutor {
  return {
    kind: "if",
    when: {
      op: d.op,
      conds: d.conds.map((c) => {
        const value: string | number | boolean =
          c.type === "number"
            ? c.value.trim() === ""
              ? Number.NaN
              : Number(c.value)
            : c.type === "boolean"
              ? c.value === "true"
              : c.value;
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
    conds: e.when.conds.map((c) => {
      // def cũ lưu chuỗi "true"/"false" ở vế dữ kiện ⇒ đọc thành boolean (lưu lại sẽ là boolean thật)
      const value = canonicalCondValue(c.from, c.value);
      return {
        from: srcOf(c.from),
        type:
          typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
        op: c.op,
        value: String(value),
      };
    }),
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

/** Giá trị `StageDraft.executor` của kiểu "Nếu". */
export const IF_EXECUTOR = "if";
export const IF_HANDOFF_SECTION = "Bàn giao";
export const isIf = (s: Pick<StageDraft, "executor">): boolean => s.executor === IF_EXECUTOR;

/** Chọn "Nếu": đứng một mình, tự chạy tiếp, không hành động thật, không quay lại (cố định). */
export const IF_PATCH: Partial<StageDraft> = {
  executor: IF_EXECUTOR,
  real: false,
  after: "auto",
  backTo: [],
  groupId: "",
};

/** Bản dùng để gửi/validate: Hub ép output/answerer/nguồn (không sinh output), xoá field + rẽ nhánh cũ. */
export function normalizeIf(s: StageDraft): StageDraft {
  if (!isIf(s)) return s;
  return {
    ...s,
    instruction: "",
    template: `# ${s.name.trim()}\n\n## ${IF_HANDOFF_SECTION}\n`,
    sections: [IF_HANDOFF_SECTION],
    fields: [],
    branch: [],
    answerer: "starter",
    answererId: "",
    budget: "",
    sources: [],
    mustKnow: "",
    autofix: emptyAutofix(),
  };
}
