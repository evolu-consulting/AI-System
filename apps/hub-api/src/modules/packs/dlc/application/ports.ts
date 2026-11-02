// dlc-engine · cổng của gói `dlc` (lớp 2 — chỉ kiểu). Ba phía ngoài gói: (1) repo `dlc.flows` trong tx gói (RLS `dlc_rw`), (2)
// workspace DLC (`apps/dlc-workspace`: repo git, queue, ticket Trello, deploy) qua HTTP, (3) Agent Hub — chạy một agent trong hội
// thoại của lượt (agent hỏi người ⇒ chờ người trả lời trong Chat) và sinh agent domain/QC từ agent mẫu. (3) do nền tảng cài
// (`modules/dlc-calls`) và tiêm lúc mount (`packs.mount.ts`), gói không import module hub.
import type { DlcMode } from "../domain/dlc-flow.rules";
import type { QueueItem, Ticket } from "../domain/dlc-prompts.rules";

/** Trạng thái lượt DLC giữa các stage (jsonb). Mọi trường tuỳ chọn: stage nào cần thì đọc, thiếu ⇒ báo lỗi bước. */
export type DlcState = {
  tag?: string;
  spec?: string;
  plan?: Record<string, unknown>;
  planText?: string;
  testCommand?: string;
  spawned?: string[];
  buildLog?: string;
  verifyReport?: string;
  coverage?: string;
  report?: string;
  /** Kết quả gần nhất của từng bước (khoá bước) — đưa lại cho agent khi người duyệt trả bước về. */
  results?: Record<string, string>;
  deploy?: { ok: boolean; sha: string; url: string | null; note: string };
};

export type DlcFlow = {
  id: string;
  mode: DlcMode;
  project: string;
  ticketId: string | null;
  conversationId: string | null;
  startedBy: string;
  requirement: string;
  state: DlcState;
};

export type DlcFlowsRepo = {
  get(id: string): Promise<DlcFlow | null>;
  insert(f: DlcFlow): Promise<void>;
  /** Gộp nông `patch` vào `state` (MỘT câu `state || patch`). */
  patch(id: string, patch: DlcState): Promise<void>;
};
export type DlcOwnRepos = { flows: DlcFlowsRepo };

export type ProjectView = {
  queue: QueueItem[];
  summary: Record<string, unknown>;
  log: string;
};
export type IntegrateResult = { ok: boolean; merged: boolean; item?: QueueItem | null };
export type DeployResult = {
  ok: boolean;
  sha: string;
  url: string | null;
  note: string;
  tasks: string[];
};

export type WorkspacePort = {
  upsertProject(b: { key: string; title: string; conversationId: string | null }): Promise<string>;
  ticket(id: string): Promise<Ticket | null>;
  setTicket(id: string, b: { status: "taken" | "done"; projectKey: string }): Promise<void>;
  specFiles(project: string): Promise<string>;
  putArtifact(project: string, name: string, content: string): Promise<void>;
  settings(project: string, b: { testCommand: string; stack: string }): Promise<void>;
  enqueue(project: string, items: QueueItem[]): Promise<void>;
  next(project: string): Promise<QueueItem | null>;
  integrate(project: string, taskId: string): Promise<IntegrateResult>;
  project(project: string): Promise<ProjectView>;
  /** Deploy bản đã merge (mọi việc `ready_to_deploy`); project chưa cấu hình deploy ⇒ `null`. */
  deploy(project: string): Promise<DeployResult | null>;
};

export type AgentCallOutcome = {
  status: "done" | "failed" | "timeout";
  text: string;
  dialog: { question: string; answer: string }[];
  error?: string;
};
/** Ai + ở đâu: người bắt đầu lượt, hội thoại Chat của lượt. */
export type DlcWho = { tenantId: string; userId: string; conversationId: string };

export type AgentHubPort = {
  /** Chạy `@agent prompt` trong hội thoại; agent hỏi người ⇒ chờ câu trả lời trong Chat rồi đọc tiếp, tới khi xong. */
  call(
    who: DlcWho,
    agentKey: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AgentCallOutcome>;
  /** Sinh / cập nhật agent `dlc-<project>-<domain>` từ agent mẫu; trả khoá các agent. */
  spawn(
    who: DlcWho,
    b: {
      project: string;
      template: string;
      agents: { domain: string; name: string; focus: string }[];
    },
  ): Promise<string[]>;
  /** Job agent đang gọi tool (`/mcp`, `hub.runs.id`) ⇒ hội thoại của job + vai người dùng; không thấy ⇒ null. */
  jobContext(
    tenantId: string,
    hubRunId: string,
  ): Promise<{ conversationId: string | null; userId: string; role: string } | null>;
};
/** Cầu nền tảng ↔ gói (khuôn `PackRunsBridge`): nền tảng gắn `port` khi đã dựng Agent Hub. */
export type AgentHubBridge = { port?: AgentHubPort };
