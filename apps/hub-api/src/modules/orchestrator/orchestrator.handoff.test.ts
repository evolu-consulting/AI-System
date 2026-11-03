// CR-114 · hub-agent-handoff · phần thuần của bàn giao trong vòng Orchestrator.
import { describe, expect, it } from "bun:test";
import { type ArtifactRef, HANDOFF_HINT } from "../artifacts/artifact.rules";
import {
  compactRunHistory,
  delegatePrompt,
  type LoopHandoff,
  STEP_EXCERPT_CHARS,
  stepsView,
  storeOutput,
} from "./orchestrator.handoff";
import type { StepNote } from "./orchestrator.prompt";

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
    canFetch: () => true,
  };
};

describe("CR-114 · orchestrator.handoff", () => {
  it("kết quả agent dài vào steps bằng tham chiếu", () => {
    const notes: StepNote[] = [
      { agent: "r", status: "done", text: LONG },
      { agent: "x", status: "skipped", reason: "not_allowed" },
      { agent: "n", status: "done", text: LONG },
    ];
    const v = stepsView(notes, [REF, null, REF]);
    const first = v[0] as Extract<StepNote, { status: "done" }>;
    expect(first.text.endsWith(" [full: art:aaaaaaaa, 751 tok]")).toBe(true);
    expect([...first.text].length).toBeLessThan(STEP_EXCERPT_CHARS + 40);
    expect(v[1]).toEqual(notes[1] as StepNote);
    expect(v[2]).toEqual(notes[2] as StepNote); // bước mới nhất giữ nguyên văn
  });

  it("nhỏ thì không lưu; kho lỗi thì giữ nguyên văn", async () => {
    const h = handoff();
    expect(await storeOutput(h, "ngắn")).toBeNull();
    expect(h.puts).toEqual([]);
    expect(await storeOutput(h, LONG)).toEqual(REF);
    expect(await storeOutput(handoff(true), LONG)).toBeNull();
  });

  it("delegate: không bước trước giữ task; có thì phong bì, agent không MCP nhận nguyên văn", () => {
    expect(delegatePrompt("việc", [], { canFetch: true })).toBe("việc");
    const prior = [{ agent: "r", text: LONG, ref: REF }];
    const fetch = delegatePrompt("việc", prior, { canFetch: true, budget: 900 });
    expect(fetch).toBe(
      `{"g":"việc","in":[{"ref":"art:aaaaaaaa","sum":"Dòng đầu.","tokens":751}],"o":"answer","b":900}\n${HANDOFF_HINT}`,
    );
    const noFetch = delegatePrompt("việc", prior, { canFetch: false });
    expect(JSON.parse(noFetch)).toEqual({ g: "việc", in: [{ text: LONG }], o: "answer" });
  });

  it("lịch sử dài: một artifact cho lượt cũ, khoá nằm trong mục tóm tắt", async () => {
    const h = { ...handoff(), keepTurns: 2 };
    const hist = Array.from({ length: 5 }, (_, i) => ({ role: "user" as const, content: `t${i}` }));
    const out = await compactRunHistory(h, hist);
    expect(h.puts).toHaveLength(1);
    expect(out).toHaveLength(3);
    expect(out[0]?.content.startsWith("[3 earlier turns · full text: art:aaaaaaaa]")).toBe(true);
    expect(await compactRunHistory(h, hist.slice(0, 2))).toEqual(hist.slice(0, 2));
  });
});
