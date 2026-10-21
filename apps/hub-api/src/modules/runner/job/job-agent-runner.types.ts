// HUB-FR-89 · HUB-FR-24 · H1-R18 · P7, P8, P11 · kiểu của `JobAgentRunner` (tách khỏi job-agent-runner.ts cho gọn file ≤ 400 dòng).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type {
  HistoryItem,
  JobAutofix,
  JobFailReason,
  JobOutput,
  JobSource,
  JobSourceRead,
  RunEvent,
  TokenUsage,
} from "@ai/contracts/hub";
import type { Db } from "../../../lib/db";
import type { Logger } from "../../../lib/logger";
import type { RunFile } from "../../attachments/run-files.rules";
import type { CatalogSnapshot } from "../../config/catalog.rules";
import type { AgentConfig, ConfigSnapshot } from "../../config/config.rules";
import type { KhJobPreparer } from "../../kh/kh.job";
import type { SseEventBody } from "../../runs/sse/sse-writer";
import type { DeltaGap, DeltaSink } from "../../stream/delta-sink";
import type { ChatTokenGate } from "../../usage/chat-token-gate";
import type { RunStreamReader } from "../run-stream-reader";
import type { AgentRole, RunRef } from "../runner.rules";
export type AgentTask = {
  run: RunRef & { locale: "vi" | "en" };
  snapshot: ConfigSnapshot;
  agent: AgentConfig;
  role: AgentRole;
  prompt: string;
  /** Vắng → `agent.systemPrompt` (Orchestrator: B8 nối khối định dạng §6.3). */
  systemPrompt?: string;
  history: readonly HistoryItem[];
  /** H2b P11 · có ⇒ `payload.stream=true`, `runJob` chuyển `job.delta` qua sink (plan §5.5); vắng = không stream. */
  stream?: DeltaSink;
  /** `run_steps.id` do người gọi chọn (vắng → mới); `reopen` = thử lại cùng step (Orchestrator JSON hỏng, plan §6.1). */
  stepId?: string;
  reopen?: boolean;
  /** H2b P13 · gộp vào `run_steps.detail` (lúc tạo và lúc kết thúc step), vd `{scope}` (R09). */
  detail?: Readonly<Record<string, unknown>>;
  /** H2c P9 · tập file của run (`RunContext.files`); chỉ job vai `agent` dùng (P10); vắng/rỗng = như H2b. */
  files?: readonly RunFile[];
  /** P-b PB-R10 · nguồn chỉ-đọc của stage (git/library/local đã ghim); có ⇒ payload.sources + Read/Grep/Glob. */
  sources?: readonly JobSource[];
  /** P-b2 R12 · job stage quy trình: `false` ⇒ `payload.use_session=false` (Hub tự quyết resume); vắng ⇒ như cũ. */
  useSession?: boolean;
  /** K1 plan §3.4 bước 0 · `stage_runs.id` do launcher stage truyền (đơn + mọi job nhóm); vắng ⇒ không phải job stage ⇒ không KH. */
  stageRunId?: string;
  /** P-c1 · PC-R05 · phần `payload.autofix` của job stage tự-sửa (launcher dựng qua `autofixJobPart`). */
  autofix?: JobAutofix;
  /** Phát `step.started`/`step.finished` (vd `writer.emit`); vắng → không phát. */
  emit?: (ev: SseEventBody) => Promise<unknown>;
  /** HD3 · #219 · agent KHÔNG tool (trích hợp đồng qua `PackRuns.agent`): `allowed_tools=[]`, `mcp=null`, không KH. */
  noTools?: boolean;
};

/** plan §5.6. Sự kiện của đúng một job, kết thúc bằng `job.result`/`job.failed`; `signal` abort → dừng, không ghi gì. */
export interface AgentRunner {
  run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent>;
}

/** H2b P11 · phần đã phát (S), `seq` hở (nếu có) và step của job (để ghi trace). */
export type JobStreamed = { streamed: string; gap: DeltaGap | null; stepId: string };

export type JobOutcome =
  | ({
      kind: "result";
      jobId: string;
      output: JobOutput;
      usage: TokenUsage;
      /** P-b C18 · file nguồn Runtime đã đọc (từ `job.result.source_reads`); Hub ghi audit + kiểm `## Nguồn tham chiếu`. */
      sourceReads?: readonly JobSourceRead[];
    } & JobStreamed)
  | ({
      kind: "failed";
      jobId: string;
      code: ChatRunErrorCode;
      reason: JobFailReason | null;
      usage: TokenUsage;
    } & JobStreamed)
  | { kind: "aborted" };

export type JobAgentRunnerDeps = {
  db: Db;
  /** = `HUB_INSTANCE_ID` (`runs.owner`): chỉ chủ còn giữ run mới INSERT job (H1-R14). */
  owner: string;
  reader: RunStreamReader;
  /** = `HUB_JOB_MAX_WAIT_S` (P8). */
  maxWaitS: number;
  log: Logger;
  pollMs?: number;
  /** H2a · MCP cho agent gắn workflow (R18): `url` = `HUB_PUBLIC_INTERNAL_URL + "/mcp"`; vắng → `mcp: null`. */
  mcp?: {
    url: string;
    catalog: () => Promise<CatalogSnapshot>;
    /** commands-unfreeze · quyền feature của người gọi (entitlement + grant); vắng ⇒ không lọc. */
    gate?: (tenantId: string, userId: string) => Promise<(workflowId: string) => boolean>;
  };
  /** K1 · `khPrepareJob` (KH của job stage); vắng ⇒ không `kh-query`. */
  kh?: KhJobPreparer;
  /** TD #252 · cửa trần token tenant (giữ chỗ trước khi đẩy job chat); vắng ⇒ không chặn (test). */
  tokenGate?: ChatTokenGate;
};
