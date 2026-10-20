// HUB-FR-20 · HUB-FR-29 · H2c-R15 · tin có file: Orchestrator không đọc được nội dung file ⇒ không được tự `answer` thay
// agent (đã gặp ở model nhỏ: "không đọc được file"). Luật cứng: chưa agent nào xử lý mà Orchestrator `answer` ⇒ giao agent
// dự phòng (noMatch fallback → `assistant` → agent đầu trong quyền); job Orchestrator khi có file không stream (chặn kịp).
import { describe, expect, it } from "bun:test";
import type { AgentResult, JobOutput, OrchestratorDecision, TokenUsage } from "@ai/contracts/hub";
import { accessInput, visibleAgents } from "../agents/agent-access.rules";
import type { FileBrief } from "../attachments/run-files.rules";
import type { AgentConfig } from "../config/config.rules";
import { type LoopInput, type LoopIo, type LoopJob, runLoop } from "./orchestrator.loop";
import { FILES_RULE, FORMAT_BLOCK, orchestratorSystemPrompt } from "./orchestrator.prompt";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const agent = (id: string, key: string): AgentConfig => ({
  id,
  key,
  name: { vi: key, en: key },
  description: `mô tả ${key}`,
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: "p",
  systemPrompt: `sys ${key}`,
  runtimeOptions: {},
  timeoutS: 60,
  tokenBudget: null,
  enabled: true,
  version: 1,
});
const ORCH = agent("o", "orchestrator");
const ASSIST = agent("a", "assistant");
const CONSULT = agent("c", "consultant");
const FILE: FileBrief = { name: "hop-dong.txt", mime: "text/plain", size: 120 } as FileBrief;

/** `usable` = agent người gửi dùng được (entitlement + grant); Orchestrator luôn có entitlement. */
function input(usable: AgentConfig[], over: Partial<LoopInput> = {}): LoopInput {
  const agents = [ORCH, ASSIST, CONSULT];
  const access = accessInput(
    {
      agents,
      entitlements: [ORCH, ...usable].map((a) => ({ agentId: a.id, tenantId: T, revokedAt: null })),
      grants: usable.map((a) => ({ agentId: a.id, tenantId: T, subject: U })),
      orchestrator: { agentId: ORCH.id },
    },
    { tenantId: T, userId: U, groupIds: new Set() },
  );
  return {
    orchestrator: ORCH,
    agents,
    settings: { maxSteps: 5, tokenBudget: 200_000 },
    access,
    visible: visibleAgents(access),
    hint: { last_agent: null, waiting_for: null },
    history: [],
    message: "Đọc file, cho biết giá trị hợp đồng",
    locale: "vi",
    attachments: [FILE],
    stream: true,
    ...over,
  };
}

type Reply = JobOutput;
const USAGE: TokenUsage = { input_tokens: 10, output_tokens: 5 };
const say = (d: OrchestratorDecision): Reply => ({ kind: "text", text: JSON.stringify(d) });
const res = (r: AgentResult): Reply => ({ kind: "agent_result", result: r });
const ANSWER = say({ decision: "answer", text: "Tôi không đọc được file." });

function fakeIo(script: (j: LoopJob, n: number) => Reply) {
  const jobs: LoopJob[] = [];
  const io: LoopIo = {
    job: async (j) => {
      jobs.push(j);
      return { kind: "result", output: script(j, jobs.length), usage: USAGE };
    },
    skip: async () => {},
  };
  return { io, jobs };
}

describe("Orchestrator · tin có file [HUB-FR-20 · H2c-R15]", () => {
  it("có file + Orchestrator `answer` khi chưa agent nào xử lý ⇒ giao `assistant`, prompt = tin gốc; job Orchestrator không stream", async () => {
    const f = fakeIo((_j, n) =>
      n === 1 ? ANSWER : res({ status: "done", text: "Giá trị 125 triệu" }),
    );
    expect(await runLoop(f.io, input([ASSIST, CONSULT]))).toEqual({
      kind: "text",
      text: "Giá trị 125 triệu",
      agentId: ASSIST.id,
    });
    expect(f.jobs.map((j) => j.role)).toEqual(["orchestrator", "agent"]);
    expect(f.jobs[0]?.stream).toBeUndefined();
    expect(f.jobs[1]).toMatchObject({
      agent: { key: "assistant" },
      prompt: "Đọc file, cho biết giá trị hợp đồng",
    });
  });

  it("ưu tiên agent dự phòng của tenant (noMatch fallback) hơn `assistant`", async () => {
    const f = fakeIo((_j, n) => (n === 1 ? ANSWER : res({ status: "done", text: "ok" })));
    const noMatch = {
      kind: "fallback" as const,
      agent: { id: CONSULT.id, key: CONSULT.key, description: "" },
    };
    await runLoop(f.io, input([ASSIST, CONSULT], { noMatch }));
    expect(f.jobs[1]?.agent.key).toBe("consultant");
  });

  it("không có `assistant` trong quyền ⇒ agent đầu tiên người gửi dùng được", async () => {
    const f = fakeIo((_j, n) => (n === 1 ? ANSWER : res({ status: "done", text: "ok" })));
    await runLoop(f.io, input([CONSULT]));
    expect(f.jobs[1]?.agent.key).toBe("consultant");
  });
});

describe("Orchestrator · tin có file (không agent, đã xử lý, prompt)", () => {
  it("không agent nào trong quyền ⇒ giữ câu trả lời của Orchestrator", async () => {
    const f = fakeIo(() => ANSWER);
    expect(await runLoop(f.io, input([]))).toEqual({
      kind: "text",
      text: "Tôi không đọc được file.",
    });
    expect(f.jobs).toHaveLength(1);
  });

  it("đã có agent xử lý (quay lại Orchestrator) ⇒ `answer` được nhận, không giao lại", async () => {
    const partial = res({ status: "partial", text: "đã đọc", missing: "x" });
    const f = fakeIo((_j, n) =>
      n === 1
        ? say({ decision: "delegate", agent: "consultant", task: "đọc" })
        : n === 2
          ? partial
          : ANSWER,
    );
    expect(await runLoop(f.io, input([CONSULT]))).toEqual({
      kind: "text",
      text: "Tôi không đọc được file.",
    });
    expect(f.jobs.map((j) => j.role)).toEqual(["orchestrator", "agent", "orchestrator"]);
  });

  it("không file ⇒ như cũ: `answer` trả luôn, job Orchestrator vẫn stream", async () => {
    const f = fakeIo(() => ANSWER);
    expect(await runLoop(f.io, input([ASSIST], { attachments: [] }))).toEqual({
      kind: "text",
      text: "Tôi không đọc được file.",
    });
    expect(f.jobs[0]?.stream).toBeDefined();
  });

  it("system prompt: có file ⇒ thêm FILES_RULE trước khối định dạng; không file ⇒ không đổi", () => {
    expect(orchestratorSystemPrompt("BASE")).toBe(`BASE\n\n${FORMAT_BLOCK}`);
    const withFiles = orchestratorSystemPrompt("BASE", undefined, true);
    expect(withFiles).toBe(`BASE\n\n${FILES_RULE}\n\n${FORMAT_BLOCK}`);
    expect(withFiles.endsWith(FORMAT_BLOCK)).toBe(true);
  });
});
