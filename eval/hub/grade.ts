// CR-114 hub-eval · luật chấm (thuần, không gọi model). Chấm luật trước; judge chỉ bổ sung check `judge`.
import type {
  AgentResponse,
  CaseResult,
  Check,
  EvalCase,
  JudgeVerdict,
  RouteExpect,
} from "./types";

/** Hạ chữ thường, bỏ dấu tiếng Việt, gộp khoảng trắng — để so khớp từ khoá bền với cách viết. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `a|b` ⇒ đạt khi có một trong các cách viết. */
export function hasFact(haystackNorm: string, fact: string): boolean {
  return fact.split("|").some((alt) => {
    const a = normalize(alt);
    return a !== "" && haystackNorm.includes(a);
  });
}

const searchable = (r: AgentResponse): string =>
  normalize(`${r.text}\n${r.args ? JSON.stringify(r.args) : ""}\n${r.target ?? ""}`);

function routeChecks(exp: RouteExpect, r: AgentResponse): Check[] {
  const allowed = Array.isArray(exp.action) ? exp.action : [exp.action];
  const out: Check[] = [
    {
      name: "route.action",
      ok: allowed.includes(r.action),
      detail: `got ${r.action}, want ${allowed.join("|")}`,
    },
  ];
  if (exp.target !== undefined) {
    out.push({
      name: "route.target",
      ok: r.target === exp.target,
      detail: `got ${r.target ?? "-"}, want ${exp.target}`,
    });
  }
  if (exp.confirm !== undefined) {
    out.push({
      name: "route.confirm",
      ok: (r.confirm === true) === exp.confirm,
      detail: `got ${r.confirm === true}, want ${exp.confirm}`,
    });
  }
  return out;
}

/** Các check bằng luật (không judge). */
export function ruleChecks(c: EvalCase, r: AgentResponse): Check[] {
  const e = c.expect;
  const checks: Check[] = [];
  if (e.route) checks.push(...routeChecks(e.route, r));
  const hay = searchable(r);
  for (const f of e.facts ?? []) {
    checks.push({ name: `fact:${f}`, ok: hasFact(hay, f) });
  }
  for (const f of e.forbidden ?? []) {
    // forbidden không hỗ trợ `|`: mỗi chuỗi là một mẫu cấm nguyên văn.
    const a = normalize(f);
    checks.push({ name: `forbidden:${f}`, ok: a === "" || !hay.includes(a) });
  }
  if (e.maxTokens !== undefined) {
    checks.push({
      name: "max_tokens",
      ok: r.tokensOut <= e.maxTokens,
      detail: `${r.tokensOut} > ${e.maxTokens}`,
    });
  }
  if (e.maxLatencyMs !== undefined) {
    checks.push({
      name: "max_latency",
      ok: r.latencyMs <= e.maxLatencyMs,
      detail: `${r.latencyMs}ms > ${e.maxLatencyMs}ms`,
    });
  }
  return checks;
}

/** Ca cần gọi judge: có rubric và mọi luật đã đạt. */
export function needsJudge(c: EvalCase, r: AgentResponse): boolean {
  return c.expect.judge !== undefined && ruleChecks(c, r).every((k) => k.ok);
}

export function gradeCase(c: EvalCase, r: AgentResponse, verdict?: JudgeVerdict): CaseResult {
  const checks = ruleChecks(c, r);
  if (c.expect.judge !== undefined) {
    const rulesOk = checks.every((k) => k.ok);
    if (!rulesOk) checks.push({ name: "judge", ok: false, detail: "skipped (rules failed)" });
    else if (!verdict) checks.push({ name: "judge", ok: false, detail: "not judged" });
    else
      checks.push({
        name: "judge",
        ok: verdict.pass,
        ...(verdict.note ? { detail: verdict.note } : {}),
      });
  }
  const passed = checks.filter((k) => k.ok).length;
  return {
    id: c.id,
    agent: c.agent,
    pass: checks.every((k) => k.ok),
    score: checks.length === 0 ? 1 : passed / checks.length,
    checks,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    latencyMs: r.latencyMs,
  };
}

/** Ca không có phản hồi (replay thiếu bản ghi / live lỗi) ⇒ trượt, không nén lỗi. */
export function missingResult(c: EvalCase, why: string): CaseResult {
  return {
    id: c.id,
    agent: c.agent,
    pass: false,
    score: 0,
    checks: [{ name: "response", ok: false, detail: why }],
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
  };
}

export function scoreByAgent(results: readonly CaseResult[]): Record<string, number> {
  const sums = new Map<string, { s: number; n: number }>();
  for (const r of results) {
    const a = sums.get(r.agent) ?? { s: 0, n: 0 };
    a.s += r.score;
    a.n += 1;
    sums.set(r.agent, a);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of [...sums].sort(([a], [b]) => (a < b ? -1 : 1))) out[k] = round(v.s / v.n);
  return out;
}

export const overallScore = (results: readonly CaseResult[]): number =>
  results.length === 0 ? 0 : round(results.reduce((s, r) => s + r.score, 0) / results.length);

export const round = (n: number): number => Math.round(n * 1000) / 1000;
