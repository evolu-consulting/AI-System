// CR-114 · hub-agent-handoff · đo kịch bản đa agent CỐ ĐỊNH (LLM giả, đếm token prompt dựng ra bằng `estimateTokens`):
// lịch sử 24 lượt → Orchestrator giao researcher → analyst → writer → trả lời. "Trước" = nguyên văn (Orchestrator phải dán kết
// quả bước trước vào `task` vì không có kênh khác); "sau" = `LoopIo.handoff` (artifact trong bộ nhớ). Đúng đắn: mọi dữ kiện
// FACTS mà writer cần đều tới được writer (trong prompt/lịch sử, hoặc qua `artifact.get` của khoá có trong prompt).
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
  content: `${i === 1 ? `Ghi nhận ${FACTS.history}. ` : ""}Lượt ${i}: ${"trao đổi về phạm vi báo cáo và định dạng. ".repeat(8)}`,
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

/** Quyết định thứ n của Orchestrator giả; `paste` = chế độ trước (dán kết quả bước trước vào task). */
const decisions = (paste: boolean): object[] => [
  { decision: "delegate", agent: "researcher", task: "Thu thập số liệu quý 3" },
  {
    decision: "delegate",
    agent: "analyst",
    task: paste ? `Phân tích số liệu sau:\n${RESEARCH}` : "Phân tích số liệu nghiên cứu",
  },
  {
    decision: "delegate",
    agent: "writer",
    task: paste
      ? `Viết báo cáo từ:\n${RESEARCH}\n${ANALYSIS}`
      : "Viết báo cáo từ nghiên cứu và phân tích",
  },
  { decision: "answer", text: REPORT },
];

function script(paste: boolean) {
  const ds = decisions(paste);
  let n = 0;
  return (j: LoopJob): JobOutput =>
    j.role === "agent"
      ? (AGENT_REPLY[j.agent.key] as JobOutput)
      : say(ds[Math.min(n++, ds.length - 1)] as object);
}

function memHandoff() {
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
    canFetch: () => true,
  };
  return { h, store };
}

const jobTokens = (j: LoopJob) =>
  estimateTokens(j.prompt) +
  estimateTokens(j.systemPrompt ?? "") +
  j.history.reduce((n, x) => n + estimateTokens(x.content), 0);

async function run(handoff?: LoopHandoff) {
  const jobs: LoopJob[] = [];
  const s = script(!handoff);
  const io: LoopIo = {
    job: async (j) => {
      jobs.push(j);
      return { kind: "result", output: s(j), usage: USAGE };
    },
    skip: async () => {},
    ...(handoff ? { handoff } : {}),
  };
  const end = await runLoop(io, input());
  return { end, jobs, tokens: jobs.reduce((n, j) => n + jobTokens(j), 0) };
}

/** Văn bản writer thấy được: prompt + lịch sử + nội dung mọi khoá `art:` xuất hiện trong đó (artifact.get). */
function reachable(j: LoopJob, store: Map<string, string>): string {
  const seen = [j.prompt, ...j.history.map((h) => h.content)].join("\n");
  const refs = seen.match(/art:[0-9a-f]{8}/g) ?? [];
  return [seen, ...refs.map((r) => store.get(r) ?? "")].join("\n");
}

describe("CR-114 · đo bàn giao bằng tham chiếu", () => {
  it("kịch bản đa agent: giảm token và đủ dữ kiện", async () => {
    const before = await run();
    const { h, store } = memHandoff();
    const after = await run(h);
    expect(before.end).toEqual({ kind: "text", text: REPORT });
    expect(after.end).toEqual(before.end);
    expect(after.jobs.map((j) => j.agent.key)).toEqual(before.jobs.map((j) => j.agent.key));

    const writer = after.jobs.find((j) => j.agent.key === "writer") as LoopJob;
    const text = reachable(writer, store);
    for (const f of [FACTS.history, ...FACTS.research, ...FACTS.analysis])
      expect(text).toContain(f);
    // Orchestrator cuối vẫn thấy nguyên văn bước mới nhất (không có MCP).
    expect(after.jobs.at(-1)?.prompt).toContain(REPORT);

    const saved = 1 - after.tokens / before.tokens;
    console.log(
      `[CR-114 handoff] prompt tokens before=${before.tokens} after=${after.tokens} saved=${(saved * 100).toFixed(1)}%`,
    );
    expect(saved).toBeGreaterThan(0.4);
  });
});
