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
  | "subprocess"
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
    e === "notify" ||
    e === "subprocess"
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
  /** Từ nghiệp vụ của bước Duyệt (khoá: `need_*`, `due`, `evidence_*`); vắng ⇒ tiếng Việt mặc định. */
  word?: (key: string, n?: number) => string;
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

/** 500000000 → "500 triệu", 2500000000 → "2,5 tỷ" (đơn vị tiền dễ đọc); giá trị khác giữ nguyên. */
const friendlyVnd = (raw: string): string => {
  const n = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isFinite(n)) return raw;
  const trim = (x: number) => String(Number(x.toFixed(2))).replace(".", ",");
  if (n >= 1_000_000_000) return `${trim(n / 1_000_000_000)} tỷ`;
  if (n >= 1_000_000 && n % 100_000 === 0) return `${trim(n / 1_000_000)} triệu`;
  return raw;
};

function ifLine(s: StageDraft, l: SummaryLabels): string {
  const c = s.ifx.conds[0];
  if (!c || c.from === "") return "";
  const [kind, a, b] = c.from.split("|");
  const left = kind === "fact" ? l.fact(a ?? "") : kind === "field" ? `${a}.${b}` : (a ?? "");
  return `${left} ${l.op(c.op)} ${friendlyVnd(String(c.value))}`.trim();
}

const APPROVE_WORDS: Record<string, string> = {
  need_one: "một người nhận việc",
  need_head: "trưởng phòng",
  need_all: "tất cả",
  evidence_opinion_plus: "ý kiến + chữ ký hoặc tệp",
};

/** CR-127 · U2 · Duyệt: «một người nhận việc · 48 giờ · ý kiến + chữ ký hoặc tệp» (chỉ nói phần đã đặt khác mặc định, trừ Cần luôn nói). */
function approveLine(s: StageDraft, l: SummaryLabels): string {
  const w = (k: string, n?: number) =>
    l.word?.(k, n) ?? (k === "due" ? `${n} giờ` : (APPROVE_WORDS[k] ?? k));
  const need = s.review?.need ?? (s.review?.headOnly ? "head" : "one");
  const parts = [w(`need_${need}`)];
  if (s.escalate.on && s.escalate.afterH.trim() !== "")
    parts.push(w("due", Number(s.escalate.afterH)));
  if (s.review?.evidence === "opinion_plus") parts.push(w("evidence_opinion_plus"));
  return parts.join(" · ");
}

/** Một dòng tóm tắt (rỗng nếu không có gì đáng nói). */
export function summaryOf(s: StageDraft, l: SummaryLabels): string {
  switch (kindOf(s)) {
    case "set":
      return setLine(s, l);
    case "if":
      return ifLine(s, l);
    case "approve":
      return approveLine(s, l);
    default:
      return "";
  }
}
