import { describe, expect, test } from "bun:test";
import {
  aggregateProbe,
  aggregateScenario,
  type Baseline,
  compare,
  type ProbeStat,
  parseKv,
  parseProbeLog,
  pctile,
  planRuns,
  renderTable,
} from "./perf-probe.rules";

const S = (ms: number, sql = 2, rt = 1) => ({ ms, cpu: ms / 2, rss: 10, sql, rt });

describe("parseKv / parseProbeLog", () => {
  test("kv có ngoặc kép + tiền tố nhiễu của pytest", () => {
    expect(parseKv('t=5 e=probe.m v="a b" n=1')).toEqual({
      t: "5",
      e: "probe.m",
      v: "a b",
      n: "1",
    });
    const log = [
      "tests/perf_probe/x_int_test.py t=1 e=probe.meta scn=a pg=16.15 size=small",
      "t=2 e=probe.x ms=5 cpu=1 rss=0 sql=1 rt=1", // trước start ⇒ bỏ
      "t=3 e=probe.scenario.start scn=a r=1",
      "t=4 e=probe.x ms=10 cpu=2 rss=4 sql=3 rt=2",
      "ruồi: dòng thường",
      "t=5 e=probe.x ms=20 cpu=2 rss=4 sql=3 rt=2",
      "t=6 e=probe.scenario.end scn=a r=1 ms=100 cpu=50 rss=999 conns=7",
      "t=7 e=probe.x ms=99 cpu=2 rss=4 sql=3 rt=2", // sau end ⇒ bỏ
    ].join("\n");
    const p = parseProbeLog(log);
    expect(p.runs.a?.get(1)?.x?.map((s) => s.ms)).toEqual([10, 20]);
    expect(p.meta.a?.pg).toBe("16.15");
    expect(p.ends.a?.get(1)?.conns).toBe("7");
  });
});

describe("aggregate", () => {
  test("p50/p95/mean gộp mọi lượt + spread theo p50 mỗi lượt", () => {
    const run = (xs: number[]) => xs.map((x) => S(x));
    const st = aggregateProbe([
      run([10, 10, 10, 10]),
      run([12, 12, 12, 12]),
      run([11, 11, 11, 11]),
    ]);
    expect(st.n).toBe(12);
    expect(st.p50).toBe(11);
    expect(st.p95).toBe(12);
    expect(st.mean).toBe(11);
    expect(st.spread).toBe(18.2); // (12-10)/11
    expect(st.sql).toBe(2);
  });
  test("pctile gần nhất", () => {
    expect(pctile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(pctile([], 50)).toBe(0);
  });
  test("aggregateScenario đọc scn.end (trung vị) và size/pg từ meta", () => {
    const log = [0, 1, 2]
      .flatMap((i) => [
        `t=1 e=probe.scenario.start scn=a r=${i + 1}`,
        `t=1 e=probe.x ms=${10 + i} cpu=1 rss=1 sql=2 rt=1`,
        `t=1 e=probe.scenario.end scn=a r=${i + 1} ms=${100 + i} cpu=5 rss=1000 conns=4`,
      ])
      .concat("t=0 e=probe.meta scn=a pg=16.15 size=large");
    const a = aggregateScenario(parseProbeLog(log.join("\n")), "a");
    expect(a).toMatchObject({ runs: 3, size: "large", pg: "16.15", scn: { ms: 101, conns: 4 } });
  });
});

const probeStat = (p50: number, o: Partial<ProbeStat> = {}): ProbeStat => ({
  n: 30,
  p50,
  p95: p50 * 1.2,
  mean: p50,
  sql: 4,
  rt: 2,
  cpu: 1,
  rss: 0,
  spread: 2,
  ...o,
});
const bl = (probes: Record<string, ProbeStat>, runs = 3): Baseline => ({
  scenario: "a",
  commit: "abc1234",
  date: "2026-11-03T00:00:00Z",
  env: { pg: "16", cpus: "?", exclusive: true },
  size: "small",
  runs,
  scn: { ms: 1, cpu: 1, rss: 1, conns: 1 },
  probes,
});

describe("compare", () => {
  test("> 10% chậm hơn vượt nhiễu ⇒ REGRESSION; > 20% nhanh hơn ⇒ win; còn lại ok", () => {
    const base = bl({ a: probeStat(100), b: probeStat(100), c: probeStat(100) });
    const now = bl({ a: probeStat(115), b: probeStat(70), c: probeStat(105) });
    const c = compare(base, now);
    const f = Object.fromEntries(c.rows.map((r) => [r.name, r.flag]));
    expect(f).toEqual({ a: "REGRESSION", b: "win", c: "ok" });
    expect(c.regressed).toBe(true);
  });
  test("nhiễu: Δ 15% nhưng spread 20% ⇒ noise, không đỏ", () => {
    const c = compare(bl({ a: probeStat(100, { spread: 20 }) }), bl({ a: probeStat(115) }));
    expect(c.rows[0]?.flag).toBe("noise");
    expect(c.regressed).toBe(false);
  });
  test("số câu SQL tăng > 10% là REGRESSION dù ms không đổi (tất định)", () => {
    const c = compare(bl({ a: probeStat(100) }), bl({ a: probeStat(100, { sql: 6 }) }));
    expect(c.rows[0]).toMatchObject({ flag: "REGRESSION", dSql: 2 });
  });
  test("cần ≥ 3 lượt mỗi bên", () => {
    const c = compare(bl({ a: probeStat(1) }), bl({ a: probeStat(1) }, 2));
    expect(c.error).toContain("≥ 3");
    expect(c.regressed).toBe(false);
  });
  test("probe mới / biến mất không làm đỏ", () => {
    const c = compare(bl({ a: probeStat(1) }), bl({ b: probeStat(1) }));
    expect(c.rows.map((r) => r.flag).sort()).toEqual(["gone", "new"]);
  });
  test("bảng ≤ 15 dòng kể cả 30 probe", () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`p${i}`, probeStat(100 + i)]),
    );
    const c = compare(bl(many), bl(many));
    expect(renderTable("a", bl(many), bl(many), c).split("\n").length).toBeLessThanOrEqual(15);
  });
});

describe("planRuns", () => {
  test("gộp mọi kịch bản perf thành một lượt, py riêng, file trùng chỉ một lần", () => {
    const p = planRuns(["timer.fire", "remind", "expire", "claim.n"]);
    expect(p.map((x) => x.step)).toEqual(["perf", "py"]);
    expect(p[0]?.filter).toBe(
      "tests/perf-probe/timer-fire.perf.int.test.ts tests/perf-probe/remind-expire.perf.int.test.ts",
    );
    expect(p[0]?.scns).toEqual(["timer.fire", "remind", "expire"]);
    expect(() => planRuns(["nope"])).toThrow();
  });
});
