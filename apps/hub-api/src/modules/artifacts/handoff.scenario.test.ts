// CR-114 · hub-agent-handoff (+ fix114) · kịch bản đa agent CỐ ĐỊNH (LLM giả, đếm token prompt bằng `estimateTokens`):
// lịch sử 24 lượt (dữ kiện ở lượt cũ, sau ký tự 120) → Orchestrator giao researcher → analyst → writer → trả lời; Orchestrator
// dán kết quả bước trước vào `task` (nó không biết người nhận có MCP hay không). Runner giả chọn bản job như `JobAgentRunner`
// (`jobVariant`: `byRef` chỉ khi job có `artifact-get`). Đúng đắn: Orchestrator thấy y như tắt cờ; agent không MCP nhận y như
// tắt cờ; agent có MCP tới được mọi dữ kiện (prompt/lịch sử + `artifact-get` của khoá có trong đó).
import { describe, expect, it } from "bun:test";
import type { AgentResult, HistoryItem, JobOutput, TokenUsage } from "@ai/contracts/hub";
import { accessInput, visibleAgents } from "../agents/agent-access.rules";
import type { AgentConfig } from "../config/config.rules";
import type { LoopHandoff } from "../orchestrator/orchestrator.handoff";
import {
  type LoopInput,
  type LoopIo,
  type LoopJob,
  runLoop,
} from "../orchestrator/orchestrator.loop";
import { ARTIFACT_GET, jobVariant } from "./artifact.mcp";
import { type ArtifactRef, artifactKey, estimateTokens, shortKey } from "./artifact.rules";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const agent = (id: string, key: string): AgentConfig => ({
  id,
  key,
  name: { vi: key, en: key },
  description: `agent ${key}`,
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
const RES = agent("r", "researcher");
const ANA = agent("n", "analyst");
const WRI = agent("w", "writer");
const AGENTS = [ORCH, RES, ANA, WRI];

const FACTS = {
  history: "mã khách hàng KH-7781",
  research: ["doanh thu Q3 42,7 tỷ", "chi phí logistics tăng 18%", "đối thủ chính VinaTrans"],
  analysis: ["biên lợi nhuận gộp 23,4%", "rủi ro tỷ giá USD/VND", "đề xuất tăng giá 4%"],
};
const filler = (tag: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `${tag} đoạn ${i}: số liệu chi tiết theo vùng, kênh và tháng, kèm ghi chú nguồn.`,
  ).join("\n");
const RESEARCH = `Kết quả nghiên cứu.\n${FACTS.research.join("\n")}\n${filler("NC", 45)}`;
const ANALYSIS = `Phân tích.\n${FACTS.analysis.join("\n")}\n${filler("PT", 40)}`;
const REPORT = "Báo cáo cuối: tóm tắt cho khách KH-7781.";

const HISTORY: HistoryItem[] = Array.from({ length: 24 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `Lượt ${i}: ${"trao đổi về phạm vi báo cáo và định dạng. ".repeat(8)}${i === 1 ? `Ghi nhận ${FACTS.history}.` : ""}`,
}));

function input(): LoopInput {
  const access = accessInput(
    {
      agents: AGENTS,
      entitlements: AGENTS.map((a) => ({ agentId: a.id, tenantId: T, revokedAt: null })),
      grants: [RES, ANA, WRI].map((a) => ({ agentId: a.id, tenantId: T, subject: U })),
      orchestrator: { agentId: ORCH.id },
    },
    { tenantId: T, userId: U, groupIds: new Set() },
  );
  return {
    orchestrator: ORCH,
    agents: AGENTS,
    settings: { maxSteps: 10, tokenBudget: 1_000_000 },
    access,
    visible: visibleAgents(access),
    hint: { last_agent: null, waiting_for: null },
    history: HISTORY,
    message: "Lập báo cáo quý cho khách",
    locale: "vi",
  };
}

const USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 };
const say = (o: object): JobOutput => ({ kind: "text", text: JSON.stringify(o) });
const done = (text: string): JobOutput => ({
  kind: "agent_result",
  result: { status: "done", text } as AgentResult,
});

/** Researcher `partial` (thiếu phân tích) ⇒ không pass-through (H1-R08), các bước sau vào `<steps>`. */
const AGENT_REPLY: Record<string, JobOutput> = {
  researcher: {
    kind: "agent_result",
    result: { status: "partial", text: RESEARCH, missing: "phân tích" } as AgentResult,
  },
  analyst: done(ANALYSIS),
  writer: done(REPORT),
};

/** Khối `<handoff>` trong prompt Orchestrator (vắng ⇒ null). */
type Hint = { agents: string[]; refs: { ref: string; sum: string }[] };
const hintOf = (prompt: string): Hint | null => {
  const m = /<handoff>\n(.*)\n/.exec(prompt);
  return m?.[1] ? (JSON.parse(m[1]) as Hint) : null;
};

/**
 * Orchestrator giả làm đúng luật `<handoff>`: agent nhận tham chiếu ⇒ task chỉ ghi khoá + tóm tắt; còn lại dán nguyên văn kết
 * quả bước trước (như khi tắt cờ).
 */
function decide(n: number, prompt: string): object {
  const h = hintOf(prompt);
  const task = (agent: string, goal: string, pasted: string) =>
    h?.agents.includes(agent)
      ? `${goal}: ${h.refs.map((r) => `${r.ref} (${r.sum})`).join(", ")}`
      : `${goal}:\n${pasted}`;
  if (n === 0) return { decision: "delegate", agent: "researcher", task: "Thu thập số liệu quý 3" };
  if (n === 1)
    return { decision: "delegate", agent: "analyst", task: task("analyst", "Phân tích", RESEARCH) };
  if (n === 2) {
    const t = task("writer", "Viết báo cáo", `${RESEARCH}\n${ANALYSIS}`);
    return { decision: "delegate", agent: "writer", task: t };
  }
  return { decision: "answer", text: REPORT };
}

function script() {
  let n = 0;
  return (j: LoopJob): JobOutput =>
    j.role === "agent" ? (AGENT_REPLY[j.agent.key] as JobOutput) : say(decide(n++, j.prompt));
}

/** Kho trong bộ nhớ; `ref` = agent mà runner cấp `artifact-get` (thay cho `artifactAccess` của runner thật). */
function memHandoff(ref: ReadonlySet<string>) {
  const store = new Map<string, string>();
  const h: LoopHandoff = {
    put: async (body, meta): Promise<ArtifactRef> => {
      const key = artifactKey(body);
      store.set(shortKey(key), body);
      return {
        key,
        short: shortKey(key),
        tokens: estimateTokens(body),
        summary: meta.summary ?? body.split("\n")[0] ?? "",
      };
    },
    refAgents: async (agents) => new Set(agents.map((a) => a.key).filter((k) => ref.has(k))),
  };
  return { h, store };
}

/** Bản job runner dùng thật: agent trong `mcp` ⇒ job có `artifact-get`; còn lại không MCP (noTools/direct/đủ tool). */
type Served = { key: string; role: string; prompt: string; history: readonly HistoryItem[] };
const serve = (j: LoopJob, mcp: ReadonlySet<string>): Served => {
  const tools = j.role === "agent" && mcp.has(j.agent.key) ? { tools: [ARTIFACT_GET] } : null;
  const v = jobVariant(j, tools);
  return { key: j.agent.key, role: j.role, prompt: v.prompt, history: v.history };
};

const histTokens = (h: readonly HistoryItem[]) =>
  h.reduce((m, x) => m + estimateTokens(x.content), 0);

/** Token = prompt dựng cho mọi job + lịch sử + đầu ra quyết định của Orchestrator (phần chép lại là token ra). */
async function run(handoff: LoopHandoff | undefined, mcp: ReadonlySet<string>) {
  const jobs: Served[] = [];
  const s = script();
  let tokens = 0;
  const io: LoopIo = {
    job: async (j) => {
      const sv = serve(j, mcp);
      jobs.push(sv);
      const output = s(j);
      tokens += estimateTokens(sv.prompt) + histTokens(sv.history);
      if (output.kind === "text") tokens += estimateTokens(output.text);
      return { kind: "result", output, usage: USAGE };
    },
    skip: async () => {},
    ...(handoff ? { handoff } : {}),
  };
  const end = await runLoop(io, input());
  return { end, jobs, tokens };
}

/** Văn bản job thấy được: prompt + lịch sử + nội dung mọi khoá `art:` xuất hiện trong đó (`artifact-get`). */
function reachable(j: Served, store: Map<string, string>): string {
  const seen = [j.prompt, ...j.history.map((h) => h.content)].join("\n");
  const refs = seen.match(/art:[0-9a-f]{8}/g) ?? [];
  return [seen, ...refs.map((r) => store.get(r) ?? "")].join("\n");
}

const ALL = new Set(["researcher", "analyst", "writer"]);
const NONE: ReadonlySet<string> = new Set();
const ALL_FACTS = [FACTS.history, ...FACTS.research, ...FACTS.analysis];
const strip = (p: string) => p.replace(/\n<handoff>\n[\s\S]*?\n<\/handoff>/, "");

describe("CR-114 · đo bàn giao bằng tham chiếu", () => {
  it("kịch bản đa agent: giảm token và đủ dữ kiện", async () => {
    const off = await run(undefined, ALL);
    const { h, store } = memHandoff(ALL);
    const on = await run(h, ALL);
    expect(off.end).toEqual({ kind: "text", text: REPORT });
    expect(on.end).toEqual(off.end);
    // Orchestrator (không MCP) vẫn thấy lịch sử + `<steps>` nguyên văn; chỉ THÊM khối `<handoff>` (sau breakpoint cache).
    const orch = (r: typeof on) => r.jobs.filter((j) => j.role === "orchestrator");
    expect(orch(on).map((j) => ({ ...j, prompt: strip(j.prompt) }))).toEqual(orch(off));
    for (const j of orch(on)) expect(j.prompt).toContain(FACTS.history);
    // 7/7 dữ kiện tới writer (và analyst đủ dữ kiện nghiên cứu) qua prompt/lịch sử + artifact-get.
    const writer = on.jobs.find((j) => j.key === "writer") as Served;
    for (const f of ALL_FACTS) expect(reachable(writer, store)).toContain(f);
    const analyst = on.jobs.find((j) => j.key === "analyst") as Served;
    for (const f of FACTS.research) expect(reachable(analyst, store)).toContain(f);
    expect(writer.prompt).not.toContain(FACTS.analysis[2]); // không chép lại — chỉ ref
    const saved = 1 - on.tokens / off.tokens;
    console.log(
      `[CR-114 handoff] tokens off=${off.tokens} on=${on.tokens} saved=${(saved * 100).toFixed(1)}%`,
    );
    expect(saved).toBeGreaterThan(0.25);
  });

  it("agent không có artifact-get (noTools / direct-SDK / đủ tool) nhận nguyên văn như tắt cờ", async () => {
    const off = await run(undefined, NONE);
    const on = await run(memHandoff(NONE).h, NONE);
    expect(on.jobs).toEqual(off.jobs);
    const writer = on.jobs.find((j) => j.key === "writer") as Served;
    for (const f of ALL_FACTS)
      expect([writer.prompt, ...writer.history.map((x) => x.content)].join("\n")).toContain(f);
  });

  it("runner báo nhận tham chiếu nhưng lúc chạy job không có artifact-get ⇒ bản nguyên văn tự đính kèm toàn văn", async () => {
    const { h } = memHandoff(ALL);
    const on = await run(h, NONE);
    const writer = on.jobs.find((j) => j.key === "writer") as Served;
    for (const f of ALL_FACTS)
      expect([writer.prompt, ...writer.history.map((x) => x.content)].join("\n")).toContain(f);
  });
});
