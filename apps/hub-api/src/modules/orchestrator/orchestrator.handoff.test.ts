// CR-114 · hub-agent-handoff (+ fix114) · phần thuần của bàn giao trong vòng Orchestrator.
import { describe, expect, it } from "bun:test";
import { type ArtifactRef, HANDOFF_HINT } from "../artifacts/artifact.rules";
import type { AgentConfig } from "../config/config.rules";
import {
  byRefOf,
  compactRunHistory,
  delegatePrompt,
  fullPrompt,
  type HandoffState,
  type LoopHandoff,
  orchestratorHint,
  storeOutput,
} from "./orchestrator.handoff";
import { HANDOFF_RULE, orchestratorPrompt } from "./orchestrator.prompt";

const LONG = `Dòng đầu.\n${"x".repeat(3000)}`;
const REF: ArtifactRef = {
  key: "a".repeat(64),
  short: "art:aaaaaaaa",
  tokens: 751,
  summary: "Dòng đầu.",
};
const handoff = (fail = false): LoopHandoff & { puts: string[] } => {
  const puts: string[] = [];
  return {
    puts,
    put: async (body) => {
      if (fail) throw new Error("db down");
      puts.push(body);
      return REF;
    },
  };
};
const hist = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ role: "user" as const, content: `t${i}` }));

describe("CR-114 · orchestrator.handoff", () => {
  it("nhỏ thì không lưu; kho lỗi thì giữ nguyên văn", async () => {
    const h = handoff();
    expect(await storeOutput(h, "ngắn")).toBeNull();
    expect(h.puts).toEqual([]);
    expect(await storeOutput(h, LONG)).toEqual(REF);
    expect(await storeOutput(handoff(true), LONG)).toBeNull();
  });

  it("delegate: không bước trước giữ task; có thì phong bì tham chiếu", () => {
    expect(delegatePrompt("việc", [])).toBe("việc");
    const prior = [{ agent: "r", text: LONG, ref: REF }];
    expect(delegatePrompt("việc", prior, 900)).toBe(
      `{"g":"việc","in":[{"ref":"art:aaaaaaaa","sum":"Dòng đầu.","tokens":751}],"o":"answer","b":900}\n${HANDOFF_HINT}`,
    );
  });

  it("lịch sử dài: một artifact cho lượt cũ, khoá nằm trong mục tóm tắt; ngắn/lỗi kho ⇒ null", async () => {
    const h = { ...handoff(), keepTurns: 2 };
    const out = await compactRunHistory(h, hist(5));
    expect(h.puts).toHaveLength(1);
    expect(out).toHaveLength(3);
    expect(out?.[0]?.content.startsWith("[3 earlier turns · full text: art:aaaaaaaa]")).toBe(true);
    expect(await compactRunHistory(h, hist(2))).toBeNull();
    expect(await compactRunHistory({ ...handoff(true), keepTurns: 2 }, hist(5))).toBeNull();
  });

  it("khối <handoff>: chỉ khi có kết quả lưu và có agent nhận tham chiếu; nằm ngay trước <message>", async () => {
    const agents = [{ key: "a" }, { key: "b" }] as unknown as AgentConfig[];
    const h: LoopHandoff = { ...handoff(), refAgents: async () => new Set(["b"]) };
    const st: HandoffState = { outputs: [{ agent: "r", text: "ngắn", ref: null }] };
    expect(await orchestratorHint(h, st, agents)).toBeUndefined();
    st.outputs.push({ agent: "r", text: LONG, ref: REF });
    const hint = await orchestratorHint(h, st, agents);
    expect(hint).toEqual({
      agents: ["b"],
      refs: [{ agent: "r", ref: "art:aaaaaaaa", sum: "Dòng đầu." }],
    });
    const base = {
      agents: [],
      hint: { last_agent: null, waiting_for: null },
      history: [],
      steps: [],
      stepsLeft: 3,
      message: "m",
    };
    const plain = orchestratorPrompt(base);
    const withH = orchestratorPrompt({ ...base, ...(hint ? { handoff: hint } : {}) });
    const cut = plain.indexOf("<message>");
    expect(withH.slice(0, cut)).toBe(plain.slice(0, cut)); // tiền tố y hệt
    expect(withH.slice(cut)).toContain(HANDOFF_RULE);
    expect(withH.endsWith(plain.slice(cut))).toBe(true);
    const none: LoopHandoff = { ...handoff(), refAgents: async () => new Set() };
    expect(await orchestratorHint(none, { outputs: st.outputs }, agents)).toBeUndefined();
  });

  it("bản nguyên văn tự đính kèm toàn văn khi agent đã được báo nhận tham chiếu", () => {
    const st: HandoffState = {
      outputs: [{ agent: "r", text: LONG, ref: REF }],
      told: new Set(["b"]),
    };
    expect(fullPrompt("việc", st, "a")).toBe("việc");
    expect(JSON.parse(fullPrompt("việc", st, "b"))).toEqual({
      g: "việc",
      in: [{ text: LONG }],
      o: "answer",
    });
  });

  it("byRef chỉ khi có gì rút gọn", () => {
    const H = hist(3);
    expect(byRefOf("việc", [], H, null, 100)).toBeUndefined();
    expect(
      byRefOf("việc", [{ agent: "r", text: "ngắn", ref: null }], H, null, 100),
    ).toBeUndefined();
    const c = hist(1);
    expect(byRefOf("việc", [], H, c, 100)).toEqual({ prompt: "việc", history: c });
    const b = byRefOf("việc", [{ agent: "r", text: LONG, ref: REF }], H, null, 100);
    expect(b?.history).toBe(H);
    expect(b?.prompt).toContain("art:aaaaaaaa");
  });
});
