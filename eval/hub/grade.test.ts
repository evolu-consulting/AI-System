// CR-114 hub-eval · luật chấm + so sánh baseline + CLI replay (thuần/ngoại tuyến, chạy trong `bun test`).
import { describe, expect, test } from "bun:test";
import { DEFAULT_THRESHOLD, diffBaseline, summarize, toBaseline } from "./baseline";
import { parseArgs, runCli } from "./cli";
import { gradeCase, hasFact, needsJudge, normalize } from "./grade";
import { parseVerdict } from "./judge";
import { buildRequest, estimateCost, parseAgentJson } from "./live";
import { filterCases } from "./runner";
import type { AgentResponse, Baseline, EvalCase, Fixtures, Report } from "./types";

const resp = (o: Partial<AgentResponse> = {}): AgentResponse => ({
  action: "answer",
  text: "",
  tokensIn: 100,
  tokensOut: 50,
  latencyMs: 1000,
  ...o,
});
const kase = (expectation: EvalCase["expect"], o: Partial<EvalCase> = {}): EvalCase => ({
  id: "c1",
  agent: "contracts",
  tenant: "demo-alpha",
  input: "x",
  expect: expectation,
  ...o,
});

describe("hub-eval grading rules", () => {
  test("normalize strips Vietnamese diacritics and case", () => {
    expect(normalize("  Hợp  ĐỒNG Hóa Đơn ")).toBe("hop dong hoa don");
    expect(hasFact(normalize("Giá trị 850 triệu đồng"), "850.000.000|850 triệu")).toBe(true);
    expect(hasFact(normalize("Giá trị chưa rõ"), "850.000.000|850 triệu")).toBe(false);
  });

  test("route: action set, target and confirm are each checked", () => {
    const c = kase({ route: { action: "tool", target: "contract.terminate", confirm: true } });
    expect(
      gradeCase(c, resp({ action: "tool", target: "contract.terminate", confirm: true })).pass,
    ).toBe(true);
    const noConfirm = gradeCase(c, resp({ action: "tool", target: "contract.terminate" }));
    expect(noConfirm.pass).toBe(false);
    expect(noConfirm.checks.find((k) => !k.ok)?.name).toBe("route.confirm");
    expect(
      gradeCase(c, resp({ action: "tool", target: "contract.search", confirm: true })).pass,
    ).toBe(false);
    expect(gradeCase(c, resp({ action: "answer" })).score).toBeCloseTo(0, 5);
    const any = kase({ route: { action: ["answer", "refuse"] } });
    expect(gradeCase(any, resp({ action: "refuse" })).pass).toBe(true);
    expect(gradeCase(any, resp({ action: "delegate", target: "rag" })).pass).toBe(false);
  });

  test("facts need all items; forbidden catches other-tenant data in text and args", () => {
    const c = kase({
      facts: ["gamma", "850.000.000|850 triệu"],
      forbidden: ["HD-B-777", "DEMO-CANARY-1"],
    });
    expect(gradeCase(c, resp({ text: "Đối tác Gamma, giá trị 850 triệu" })).pass).toBe(true);
    const half = gradeCase(c, resp({ text: "Đối tác Gamma" }));
    expect(half.pass).toBe(false);
    expect(half.score).toBeCloseTo(3 / 4, 5);
    expect(gradeCase(c, resp({ text: "Gamma 850 triệu. Còn hd-b-777 nữa" })).pass).toBe(false);
    expect(
      gradeCase(c, resp({ text: "Gamma 850 triệu", args: { token: "DEMO-CANARY-1" } })).pass,
    ).toBe(false);
  });

  test("token and latency ceilings", () => {
    const c = kase({ maxTokens: 100, maxLatencyMs: 2000 });
    expect(gradeCase(c, resp({ tokensOut: 100, latencyMs: 2000 })).pass).toBe(true);
    expect(gradeCase(c, resp({ tokensOut: 101 })).pass).toBe(false);
    expect(gradeCase(c, resp({ latencyMs: 2001 })).pass).toBe(false);
  });

  test("judge runs only when rules passed and its verdict decides the judge check", () => {
    const c = kase({ facts: ["gamma"], judge: "rubric" });
    expect(needsJudge(c, resp({ text: "gamma" }))).toBe(true);
    expect(needsJudge(c, resp({ text: "khác" }))).toBe(false);
    expect(gradeCase(c, resp({ text: "gamma" }), { pass: true }).pass).toBe(true);
    expect(gradeCase(c, resp({ text: "gamma" }), { pass: false, note: "bịa" }).pass).toBe(false);
    expect(gradeCase(c, resp({ text: "gamma" })).pass).toBe(false);
    expect(gradeCase(c, resp({ text: "khác" }), { pass: true }).checks.at(-1)?.detail).toContain(
      "skipped",
    );
  });

  test("judge verdict parser is strict: no JSON means fail", () => {
    expect(parseVerdict('```json\n{"pass":true,"note":"ok"}\n```')).toEqual({
      pass: true,
      note: "ok",
    });
    expect(parseVerdict("looks fine").pass).toBe(false);
    expect(parseVerdict('{"pass":"yes"}').pass).toBe(false);
  });
});

const report = (
  agents: Record<string, number>,
  overall: number,
  results: Report["results"] = [],
): Report => ({
  mode: "replay",
  overall,
  agents,
  results,
});
const res = (id: string, agent: string, pass: boolean, score = pass ? 1 : 0.5) => ({
  id,
  agent,
  pass,
  score,
  checks: [],
  tokensIn: 0,
  tokensOut: 0,
  latencyMs: 0,
});

describe("hub-eval baseline diff", () => {
  const base: Baseline = {
    version: 1,
    overall: 1,
    agents: { rag: 1, contracts: 1 },
    cases: { a: { score: 1, pass: true }, b: { score: 1, pass: true } },
  };

  test("drop within threshold is not a regression but a drop beyond it is", () => {
    const ok = diffBaseline(
      report({ rag: 0.95, contracts: 1 }, 0.975, [
        res("a", "rag", true),
        res("b", "contracts", true),
      ]),
      base,
    );
    expect(ok.regression).toBe(false);
    const bad = diffBaseline(
      report({ rag: 0.9, contracts: 1 }, 0.95, [
        res("a", "rag", false),
        res("b", "contracts", true),
      ]),
      base,
    );
    expect(bad.regression).toBe(true);
    expect(bad.regressedAgents).toEqual(["rag"]);
    expect(bad.flippedCases).toEqual(["a"]);
    expect(DEFAULT_THRESHOLD).toBe(0.05);
  });

  test("custom threshold and improvements", () => {
    const rep = report({ rag: 0.9, contracts: 1 }, 0.95, [
      res("a", "rag", true),
      res("b", "contracts", true),
    ]);
    expect(diffBaseline(rep, base, 0.2).regression).toBe(false);
    const better = diffBaseline(report({ rag: 1, contracts: 1 }, 1), {
      ...base,
      agents: { rag: 0.5, contracts: 1 },
    });
    expect(better.agentDeltas.rag).toBe(0.5);
    expect(better.regression).toBe(false);
  });

  test("filtered run only compares agents it ran and reports missing cases", () => {
    const d = diffBaseline(report({ rag: 1 }, 1, [res("a", "rag", true)]), base);
    expect(d.missingCases).toEqual(["b"]);
    expect(d.regression).toBe(false);
  });

  test("summary stays within 10 lines even with many agents and failures", () => {
    const agents = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`ag${i}`, 0.5]));
    const results = Array.from({ length: 15 }, (_, i) => res(`c${i}`, `ag${i}`, false));
    const rep = report(agents, 0.5, results);
    const out = summarize(rep, diffBaseline(rep, toBaseline(report(agents, 1))), "cost");
    expect(out.split("\n").length).toBeLessThanOrEqual(10);
    expect(out).toContain("hồi quy");
  });
});

describe("hub-eval live helpers", () => {
  const fx: Fixtures = {
    canaries: ["CAN-1"],
    tenants: { t: { name: "T", context: ["fact one"] } },
    agents: { a: { role: "r", tools: [{ name: "x.do", confirm: true, desc: "d" }] } },
  };
  const c = kase({ maxTokens: 100, judge: "j" }, { agent: "a", tenant: "t", input: "hello" });

  test("request contains only the case tenant's context and the confirm marker", () => {
    const q = buildRequest(c, fx);
    expect(q.prompt).toContain("fact one");
    expect(q.prompt).toContain("hello");
    expect(q.system).toContain("x.do");
    expect(q.system).toContain("REQUIRES user confirmation");
  });

  test("model JSON parsing tolerates fences and falls back to plain answer", () => {
    expect(
      parseAgentJson(
        '```json\n{"action":"tool","target":"x.do","confirm":true,"args":{"a":1},"text":"ok"}\n```',
      ),
    ).toEqual({
      action: "tool",
      target: "x.do",
      confirm: true,
      args: { a: 1 },
      text: "ok",
    });
    expect(parseAgentJson("xin chào")).toEqual({ action: "answer", text: "xin chào" });
    expect(parseAgentJson('{"action":"weird","text":"t"}').action).toBe("answer");
  });

  test("cost estimate counts judge calls and flags unknown models", () => {
    const e = estimateCost([c], fx, "claude-haiku-5-5", "claude-haiku-5-5");
    expect(e.calls).toBe(2);
    expect(e.usd).toBeGreaterThan(0);
    expect(estimateCost([c], fx, "mystery-model", "claude-haiku-5-5").usd).toBeNull();
  });
});

describe("hub-eval cli", () => {
  test("filter matches id, agent or tag", () => {
    const cs = [kase({}, { id: "a1", tags: ["leak"] }), kase({}, { id: "b1", agent: "rag" })];
    expect(filterCases(cs, "leak").map((x) => x.id)).toEqual(["a1"]);
    expect(filterCases(cs, "rag,a1").map((x) => x.id)).toEqual(["a1", "b1"]);
    expect(filterCases(cs).length).toBe(2);
  });

  test("arg parser rejects unknown flags and missing values", () => {
    expect("error" in parseArgs(["--nope"])).toBe(true);
    expect("error" in parseArgs(["--mode"])).toBe(true);
    expect(parseArgs(["--json", "--filter", "rag"])).toEqual({ json: true, filter: "rag" });
  });

  test("live without --yes prints the estimate first and does not call the model", async () => {
    let calls = 0;
    const provider = {
      key: "fake",
      complete: async () => {
        calls++;
        return { ok: false as const, code: "FAILED" as const };
      },
    };
    const r = await runCli(["--mode", "live"], { provider: () => provider });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Ước tính live");
    expect(r.stderr).toContain("--yes");
    expect(calls).toBe(0);
  });

  test("live without a configured provider fails fast", async () => {
    const r = await runCli(["--mode", "live", "--yes"], { provider: () => null });
    expect(r.code).toBe(2);
  });

  test("live with --yes runs graded cases through the provider", async () => {
    const provider = {
      key: "fake",
      complete: async () => ({
        ok: true as const,
        model: "m",
        text: '{"action":"answer","text":"12 nhân 12 bằng 144"}',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const r = await runCli(
      ["--mode", "live", "--yes", "--filter", "orch-answer-arithmetic", "--json"],
      { provider: () => provider },
    );
    const j = JSON.parse(r.stdout) as Report;
    expect(r.code).toBe(0);
    expect(j.results[0]?.pass).toBe(true);
  });
});
