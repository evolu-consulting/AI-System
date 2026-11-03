// CR-114 hub-eval · LLM judge cho sự kiện văn tự do (chỉ khi luật đã đạt). temperature 0 do provider/CLI quyết định
// (CLI gói không có tham số nhiệt độ — prompt ép trả đúng một JSON và đáp án nhị phân để giảm dao động).
import type { JudgeVerdict } from "./types";

export const JUDGE_SYSTEM = [
  "You are a strict, deterministic grader of an AI assistant's answer. Temperature 0.",
  "You are given a QUESTION, the assistant's ANSWER and a RUBRIC (facts the answer must satisfy).",
  "Judge ONLY against the rubric. Do not reward style, length or politeness. Do not use outside knowledge.",
  'Reply with exactly one JSON object and nothing else: {"pass":true|false,"note":"<=20 words"}.',
  "pass=true only if EVERY rubric requirement is satisfied by the ANSWER.",
].join("\n");

export const judgePrompt = (question: string, answer: string, rubric: string): string =>
  `QUESTION:\n${question}\n\nANSWER:\n${answer}\n\nRUBRIC:\n${rubric}`;

/** Tách JSON đầu tiên trong đầu ra (chịu được rào ```); không đọc được ⇒ trượt (không bỏ qua lặng lẽ). */
export function parseVerdict(raw: string): JudgeVerdict {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { pass: false, note: "judge output not JSON" };
  try {
    const o = JSON.parse(m[0]) as { pass?: unknown; note?: unknown };
    return {
      pass: o.pass === true,
      ...(typeof o.note === "string" ? { note: o.note.slice(0, 200) } : {}),
    };
  } catch {
    return { pass: false, note: "judge output not JSON" };
  }
}
