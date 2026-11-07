// HUB-FR-20 · HUB-FR-21 · HUB-FR-27 · H1-R06–R09 · luật thuần Orchestrator (plan H1 §6.4).
import {
  AGENT_TEXT_MAX,
  type AgentResult,
  type OrchestratorDecision,
  OrchestratorDecisionSchema,
} from "@ai/contracts/hub";
import { chunkText } from "../../shared/chunk-text";

export { chunkText };

export type ParseDecisionResult =
  | { ok: true; decision: OrchestratorDecision }
  | { ok: false; reason: "not_json" | "schema" };

export type BudgetState = { steps: number; maxSteps: number; tokens: number; tokenBudget: number };

export type BudgetOutcome =
  | { kind: "fail"; code: "BUDGET_EXCEEDED" }
  | { kind: "finish"; text: string };

/** Câu báo nối sau câu trả lời đã có khi dừng vì ngân sách (H1-R07). */
const BUDGET_NOTE = {
  vi: "\n\n(Đã dừng vì chạm giới hạn số bước hoặc token của lượt này; kết quả có thể chưa đầy đủ.)",
  en: "\n\n(Stopped after reaching this turn's step or token limit; the result may be incomplete.)",
} as const;

/** H1-R06 · trim, bỏ code fence ngầm định: lấy từ `{` đầu tới `}` cuối rồi parse + zod. */
export function parseDecision(raw: string): ParseDecisionResult {
  const s = raw.trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j < i) return { ok: false, reason: "not_json" };
  let value: unknown;
  try {
    value = JSON.parse(s.slice(i, j + 1));
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = OrchestratorDecisionSchema.safeParse(value);
  return parsed.success ? { ok: true, decision: parsed.data } : { ok: false, reason: "schema" };
}

/** H1-R07 · `steps ≥ maxSteps ∨ tokens ≥ tokenBudget`. */
export function budgetExceeded(s: BudgetState): boolean {
  return s.steps >= s.maxSteps || s.tokens >= s.tokenBudget;
}

/** H1-R07 · chưa có câu trả lời → `BUDGET_EXCEEDED`; đã có → câu trả lời + câu báo (≤ `AGENT_TEXT_MAX`). */
export function budgetOutcome(answered: string | null, locale: "vi" | "en"): BudgetOutcome {
  if (answered === null) return { kind: "fail", code: "BUDGET_EXCEEDED" };
  const note = BUDGET_NOTE[locale];
  const room = AGENT_TEXT_MAX - note.length;
  const head = answered.length <= room ? answered : cutCodePoints(answered, room);
  return { kind: "finish", text: head + note };
}

/** H1-R08 · pass-through chỉ khi `done`, đúng 1 delegate, chưa có `partial`. */
export function canPassThrough(
  s: { delegates: number; hadPartial: boolean },
  r: AgentResult,
): boolean {
  return r.status === "done" && s.delegates === 1 && !s.hadPartial;
}

/** Cắt theo code point để không để lại nửa cặp surrogate; `maxUnits` tính theo UTF-16 như zod `max`. */
function cutCodePoints(text: string, maxUnits: number): string {
  let out = "";
  for (const cp of text) {
    if (out.length + cp.length > maxUnits) break;
    out += cp;
  }
  return out;
}

/** Token = từ kèm khoảng trắng sau nó, hoặc khoảng trắng đầu chuỗi. */
