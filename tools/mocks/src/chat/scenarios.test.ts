import { describe, expect, test } from "bun:test";
import { type Beat, buildScript, pickScenario, realWait, SCENARIO_NAMES } from "./scenarios";

const ctx = { runId: "r", flowId: "f", messageCount: 3 };
const names = (beats: Beat[]) => beats.map((b) => b.event.event);
const text = (beats: Beat[]) =>
  beats.map((b) => (b.event.event === "delta" ? b.event.data.text : "")).join("");

describe("Q-scn · pickScenario", () => {
  test("tiền tố hợp lệ thắng flow nghỉ và mặc định toàn cục", () => {
    expect(pickScenario({ content: "#scn:steps Soạn", fallback: "ask", flowIdle: true })).toBe(
      "steps",
    );
    expect(pickScenario({ content: "  #scn:ask", fallback: null, flowIdle: false })).toBe("ask");
  });
  test("tên lạ bỏ qua tiền tố; flow nghỉ → flow-cold; rồi mặc định; rồi normal", () => {
    expect(pickScenario({ content: "#scn:la x", fallback: null, flowIdle: false })).toBe("normal");
    expect(pickScenario({ content: "x", fallback: "slow", flowIdle: true })).toBe("flow-cold");
    expect(pickScenario({ content: "x", fallback: "slow", flowIdle: false })).toBe("slow");
    expect(pickScenario({ content: "x", fallback: null, flowIdle: false })).toBe("normal");
  });
});

describe("plan §3.3 · buildScript", () => {
  test("mọi kịch bản: run.started đầu, đúng một nhịp kết thúc ở cuối", () => {
    for (const name of SCENARIO_NAMES) {
      const n = names(buildScript(name, ctx));
      expect(n[0]).toBe("run.started");
      expect(n.filter((e) => e === "finish" || e === "fail").length).toBe(1);
      expect(["finish", "fail"]).toContain(n.at(-1) as string);
    }
  });
  test("normal: 30 delta, dòng cuối nêu số tin của flow (C1-R02)", () => {
    const beats = buildScript("normal", ctx);
    expect(names(beats).filter((e) => e === "delta").length).toBe(30);
    expect(text(beats).split("\n").at(-1)).toBe("Flow này có 3 tin nhắn.");
  });
  test("steps: 20 delta, ms cố định 2100/5700/7800; ask ngay trước finish", () => {
    const steps = buildScript("steps", ctx);
    expect(names(steps).filter((e) => e === "delta").length).toBe(20);
    expect(steps.at(-1)?.event).toEqual({ event: "finish", data: { ms: 7800 } });
    const ask = names(buildScript("ask", ctx));
    expect(ask.slice(-2)).toEqual(["ask", "finish"]);
  });
  test("slow 60 delta; markdown có bảng và ```ts", () => {
    expect(names(buildScript("slow", ctx)).filter((e) => e === "delta").length).toBe(60);
    const md = text(buildScript("markdown", ctx));
    expect(md).toMatch(/^\|.*\|$/m);
    expect(md).toContain("```ts");
  });
});

describe("MOCK_FAST · realWait", () => {
  test("÷10 (≥ 1), 0 giữ 0, fastMs thắng (slow 100, flow-cold 1000)", () => {
    const e = { event: "finish", data: { ms: 0 } } as const;
    expect(realWait({ waitMs: 40, event: e }, true)).toBe(4);
    expect(realWait({ waitMs: 4, event: e }, true)).toBe(1);
    expect(realWait({ waitMs: 0, event: e }, true)).toBe(0);
    expect(realWait({ waitMs: 40, event: e }, false)).toBe(40);
    expect(buildScript("slow", ctx).map((b) => realWait(b, true))[1]).toBe(100);
    expect(realWait(buildScript("flow-cold", ctx)[0] as Beat, true)).toBe(1000);
  });
});
