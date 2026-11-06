// CR-122 · U2d · node trên canvas nói bằng ngôn ngữ nghiệp vụ: loại node (khoá i18n `process.admin.flow.node.<id>`) + MỘT dòng tóm tắt
// (nguồn → trường, điều kiện, đích). Thuần: nhãn dữ kiện/phép so do nơi gọi truyền vào.
import type { StageDraft } from "./draft-types";

export type NodeKind =
  | "approve"
  | "form"
  | "if"
  | "set"
  | "tool"
  | "notify"
  | "wait"
  | "agent"
  | "finish";

/** Loại nghiệp vụ của stage (khoá `process.admin.flow.node.*`). */
export function kindOf(s: Pick<StageDraft, "executor" | "outcome">): NodeKind {
  if (s.outcome !== undefined) return "finish";
  const e = s.executor;
  if (
    e === "approve" ||
    e === "form" ||
    e === "if" ||
    e === "set" ||
    e === "tool" ||
    e === "notify"
  )
    return e;
  if (e === "wait_for" || e === "wait_until" || e === "wait_event") return "wait";
  return "agent";
}

export type SummaryLabels = {
  /** Nhãn dữ kiện theo khoá (vắng ⇒ chính khoá). */
  fact: (key: string) => string;
  op: (op: string) => string;
  /** Tên bước theo số bước (0-based). */
  step: (n: number) => string;
};

function setLine(s: StageDraft, l: SummaryLabels): string {
  const r = s.set.rows.find((x) => x.key !== "");
  if (!r) return "";
  const from =
    r.source === "fact"
      ? l.fact(r.ref)
      : r.source === "field"
        ? `${r.step === null ? "" : `${l.step(r.step)} · `}${r.ref}`
        : r.source === "input"
          ? r.input
          : r.value;
  const more = s.set.rows.length > 1 ? ` (+${s.set.rows.length - 1})` : "";
  return `${r.key} ← ${from}${more}`;
}

function ifLine(s: StageDraft, l: SummaryLabels): string {
  const c = s.ifx.conds[0];
  if (!c || c.from === "") return "";
  const [kind, a, b] = c.from.split("|");
  const left = kind === "fact" ? l.fact(a ?? "") : kind === "field" ? `${a}.${b}` : (a ?? "");
  return `${left} ${l.op(c.op)} ${c.value}`.trim();
}

/** Một dòng tóm tắt (rỗng nếu không có gì đáng nói). */
export function summaryOf(s: StageDraft, l: SummaryLabels): string {
  switch (kindOf(s)) {
    case "set":
      return setLine(s, l);
    case "if":
      return ifLine(s, l);
    default:
      return "";
  }
}
