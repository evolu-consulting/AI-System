// CR-114 hub-eval · vòng chạy eval (thuần; nguồn phản hồi + judge được tiêm: replay hoặc live).
import { gradeCase, missingResult, needsJudge, overallScore, scoreByAgent } from "./grade";
import type { AgentResponse, CaseResult, EvalCase, JudgeVerdict, Recorded, Report } from "./types";

export type Responder = (c: EvalCase) => Promise<AgentResponse | { error: string }>;
export type Judge = (c: EvalCase, r: AgentResponse) => Promise<JudgeVerdict>;

/** `--filter`: chuỗi con của id/agent/tag, phân cách bằng dấu phẩy (HOẶC). */
export function filterCases(cases: readonly EvalCase[], filter?: string): EvalCase[] {
  const terms = (filter ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (terms.length === 0) return [...cases];
  return cases.filter((c) =>
    terms.some((t) => [c.id, c.agent, ...(c.tags ?? [])].some((f) => f.toLowerCase().includes(t))),
  );
}

export async function runEval(
  mode: Report["mode"],
  cases: readonly EvalCase[],
  respond: Responder,
  judge: Judge,
): Promise<Report> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await respond(c);
    if ("error" in r) {
      results.push(missingResult(c, r.error));
      continue;
    }
    const verdict = needsJudge(c, r) ? await judge(c, r) : undefined;
    results.push(gradeCase(c, r, verdict));
  }
  return { mode, overall: overallScore(results), agents: scoreByAgent(results), results };
}

/** Replay: phản hồi và phán quyết judge đã ghi — xác định, không tốn tiền. */
export function replaySource(rec: Recorded): { respond: Responder; judge: Judge } {
  return {
    respond: async (c) =>
      rec.responses[c.id] ?? { error: "no recorded response (refresh with --mode live --record)" },
    judge: async (c, r) =>
      r.judge ?? { pass: false, note: `no recorded judge verdict for ${c.id}` },
  };
}
