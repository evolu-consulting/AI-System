// CR-114 hub-eval · bộ đo khuôn log: sinh dữ liệu xác định, 4 khuôn cùng số dòng, chấm đáp án, vòng đo với model giả.
import { describe, expect, test } from "bun:test";
import { FORMATS, generate, gradeAnswer } from "./generate";
import { type CallFn, estimateMeasure, formatEstimate, measure, plannedCalls } from "./measure";

describe("log-format eval", () => {
  test("generation is deterministic and the four formats carry the same events", () => {
    for (const complex of [false, true]) {
      const a = generate(complex);
      expect(generate(complex).formats).toEqual(a.formats);
      expect(a.events).toBe(complex ? 300 : 40);
      const lineCounts = FORMATS.map(
        (f) => a.formats[f].trimEnd().split("\n").length - (f === "num_codes" ? 1 : 0),
      );
      expect(new Set(lineCounts).size).toBe(1);
      expect(lineCounts[0]).toBe(a.events);
    }
  });

  test("kv_line is one line per event with full names and 6-char run ids; kv is the shortest of the named formats", () => {
    const ds = generate(true);
    const first = ds.formats.kv_line.split("\n")[0] ?? "";
    expect(first).toMatch(/^t=\d+ e=[a-z.]+ run=[0-9a-f]{6} ag=[a-z-]+ ms=\d+ tk=\d+\/\d+/);
    expect(ds.formats.kv_line.length).toBeLessThan(ds.formats.short_words.length);
    expect(ds.formats.short_words.length).toBeLessThan(ds.formats.verbose.length);
  });

  test("gradeAnswer counts correct keys and compares arrays order-independently", () => {
    const ds = generate(false);
    const exact = JSON.stringify(ds.answer);
    expect(gradeAnswer(ds, `\`\`\`json\n${exact}\n\`\`\``)).toEqual({ correct: 6, total: 6 });
    const wrong = { ...ds.answer, n_errors: 999 };
    expect(gradeAnswer(ds, JSON.stringify(wrong)).correct).toBe(5);
    expect(gradeAnswer(ds, "không biết")).toEqual({ correct: 0, total: 6 });
    const cx = generate(true);
    const rev = {
      ...cx.answer,
      runs_403_then_recovered: [...(cx.answer.runs_403_then_recovered as string[])].reverse(),
    };
    expect(gradeAnswer(cx, JSON.stringify(rev)).correct).toBe(6);
  });

  test("measure subtracts the empty-log baseline and grades each rep", async () => {
    const ds = generate(false);
    let calls = 0;
    const call: CallFn = async (_m, prompt) => {
      calls++;
      const empty = prompt.endsWith("(empty)");
      return {
        tokensIn: empty ? 100 : 100 + prompt.length,
        text: JSON.stringify(ds.answer),
        ms: 2000,
      };
    };
    const opts = { complex: false, models: ["haiku"], reps: 2 };
    const rows = await measure(opts, call, ds);
    expect(calls).toBe(plannedCalls(opts));
    expect(rows.map((r) => r.format)).toEqual([...FORMATS]);
    for (const r of rows) {
      expect(r.correct).toBe(12);
      expect(r.total).toBe(12);
      expect(r.secPerRun).toBe(2);
    }
    expect(rows[0]?.logTokens).toBeGreaterThan(rows[3]?.logTokens ?? Number.POSITIVE_INFINITY);
  });

  test("estimate counts planned calls and prices known models", () => {
    const opts = { complex: true, models: ["haiku", "sonnet"], reps: 2 };
    const e = estimateMeasure(opts);
    expect(e.calls).toBe(plannedCalls(opts));
    expect(e.usd).toBeGreaterThan(0);
    expect(formatEstimate(e)).toContain(`${e.calls} lời gọi`);
    expect(estimateMeasure({ ...opts, models: ["mystery"] }).usd).toBeNull();
  });

  test("run without --yes prints the estimate and exits 2 without calling a model", async () => {
    const p = Bun.spawn(["bun", `${import.meta.dir}/run.ts`, "--models", "haiku"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    expect(await p.exited).toBe(2);
    expect(out).toContain("Ước tính");
    expect(err).toContain("--yes");
  });
});
