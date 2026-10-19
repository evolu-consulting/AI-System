// TK1 · unit (không DB): đồng hồ/timer giả, fake transport, percentile, EXPLAIN parser, uuid tất định.
import { describe, expect, it } from "bun:test";
import { FakeClock, FakeTimers, T0 } from "./clock";
import { uuidOf } from "./env";
import { FakeAgent, FakeTaxRegistry, fakeSmtp, fakeWebPush } from "./fakes";
import { latencyStats, literalize, percentile, seqScansIn } from "./perf";

describe("clock", () => {
  it("FakeClock: now/advance/set/reset", () => {
    const c = new FakeClock();
    expect(c.now().getTime()).toBe(T0.getTime());
    c.advance(1500);
    expect(c.ms()).toBe(T0.getTime() + 1500);
    c.set(0);
    expect(c.now().getTime()).toBe(0);
    c.reset();
    expect(c.now().getTime()).toBe(T0.getTime());
  });
  it("FakeTimers: chạy theo thứ tự thời gian, interval lặp, clear huỷ, đồng hồ đúng mốc", () => {
    const t = new FakeTimers();
    const log: string[] = [];
    t.setTimeout(() => log.push(`b@${t.clock.ms() - T0.getTime()}`), 200);
    t.setTimeout(() => log.push(`a@${t.clock.ms() - T0.getTime()}`), 100);
    const iv = t.setInterval(() => log.push("i"), 150);
    const dead = t.setTimeout(() => log.push("dead"), 50);
    t.clear(dead);
    expect(t.advance(310)).toBe(4); // a@100, i@150, b@200, i@300
    expect(log).toEqual(["a@100", "i", "b@200", "i"]);
    t.clear(iv);
    expect(t.pending).toBe(0);
    expect(t.clock.ms()).toBe(T0.getTime() + 310);
  });
});

describe("fakes", () => {
  it("fakeSmtp: ghi tin, kịch bản theo người nhận, failNext một lần", async () => {
    const s = fakeSmtp<{ to: string }>();
    s.script = (to) => (to === "bad@x" ? { ok: false, code: "550" } : undefined);
    expect(await s.sendBatch([{ to: "a@x" }, { to: "bad@x" }])).toEqual([
      { ok: true },
      { ok: false, code: "550" },
    ]);
    expect(s.sent).toEqual([{ to: "a@x" }]);
    s.failNext = new Error("net");
    await expect(s.sendBatch([{ to: "a@x" }])).rejects.toThrow("net");
    expect(await s.sendBatch([{ to: "c@x" }])).toEqual([{ ok: true }]);
    expect(s.calls).toBe(3);
  });
  it("fakeWebPush khoá theo endpoint", async () => {
    const p = fakeWebPush<{ endpoint: string }>();
    p.script = (e) => (e === "gone" ? { ok: false, code: "410", retryable: false } : undefined);
    expect((await p.sendBatch([{ endpoint: "gone" }]))[0]).toEqual({
      ok: false,
      code: "410",
      retryable: false,
    });
  });
  it("FakeAgent: mặc định AGENT_FAILED, kịch bản, settled/signal không sleep", async () => {
    const a = new FakeAgent();
    expect(await a.transport({ tenantId: "t", prompt: "p" })).toEqual({
      ok: false,
      code: "AGENT_FAILED",
    });
    a.script = () => ({ ok: true, text: "{}" });
    expect(await a.transport({ tenantId: "t", prompt: "q" })).toEqual({ ok: true, text: "{}" });
    const w = a.settled("c1");
    a.signal("c1", "done");
    expect(await w).toBe("done");
    expect(a.calls.length).toBe(2);
  });
  it("FakeTaxRegistry: thiếu = unavailable", async () => {
    const r = new FakeTaxRegistry();
    r.answers["0101"] = { result: "found", name: "ACME", status: null };
    expect((await r.lookup("0101")).result).toBe("found");
    expect(await r.lookup("999")).toEqual({ result: "unavailable" });
    expect(r.calls).toEqual(["0101", "999"]);
  });
});

describe("perf thuần", () => {
  it("percentile nearest-rank", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow();
  });
  it("latencyStats", () => {
    expect(latencyStats([3, 1, 2])).toEqual({ n: 3, p50: 2, p95: 3, max: 3 });
  });
  it("seqScansIn: lọc theo quan hệ, duyệt cây", () => {
    const plan = {
      "Node Type": "Nested Loop",
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "a" },
        { "Node Type": "Index Scan", "Relation Name": "b" },
        { "Node Type": "Hash", Plans: [{ "Node Type": "Seq Scan", "Relation Name": "c" }] },
      ],
    };
    expect(seqScansIn(plan)).toEqual(["a", "c"]);
    expect(seqScansIn(plan, ["c"])).toEqual(["c"]);
  });
  it("literalize", () => {
    expect(literalize({ text: "x = $1 and y = $2 and z = $3", params: ["it's", 5, [1, 2]] })).toBe(
      `x = 'it''s' and y = 5 and z = '{"1","2"}'`,
    );
  });
});

describe("env", () => {
  it("uuidOf tất định, khác miền khác nhau", () => {
    expect(uuidOf(0xa1, 1)).toBe("7e5d00a1-0000-4000-8000-000000000001");
    expect(uuidOf(0xa1, 255)).toBe("7e5d00a1-0000-4000-8000-0000000000ff");
    expect(uuidOf(1, 1)).not.toBe(uuidOf(2, 1));
  });
});
