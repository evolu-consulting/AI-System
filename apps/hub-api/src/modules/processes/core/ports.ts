// HUB-FR-105 · HUB-FR-110 · HUB-FR-112 · cổng giữa các PF (plan §9 "Ports", plan-step0 §1): PF gọi nhau qua đây, không
// import file của PF khác. Bước 0 dựng bản no-op/stub; PF điền thân trong thư mục của mình.
import type { ProcessRunSummary } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import type { UserEvent } from "../../../lib/user-stream";
import type { AttachmentStorage } from "../../attachments/storage";
import type { ConfigCache } from "../../config/config.service";
import type { KhRuntime } from "../../kh/kh.mount";
import type { AgentRunner } from "../../runner/job/job-agent-runner";
import type { RunService } from "../../runs/runs.service";
import type { HubSecretReader } from "../../secrets/secrets.use";
import type { Bang } from "./bang.rules";
import type { Clock } from "./clock";

/** `!key …` hợp lệ hoặc `!`/key sai dạng (⇒ 404 `PROCESS_NOT_FOUND{suggestions}`). */
export type StartBang = Extract<Bang, { kind: "process" | "invalid" }>;

/**
 * PF1 · bắt đầu run từ Hỏi AI (D14: 202 `{process_run}`, không SSE, không lưu tin vào hội thoại). Ném 404
 * `PROCESS_NOT_FOUND{suggestions}` / 429 `TOO_MANY_PROCESS_RUNS` (+`Retry-After`). Từ phòng: `RoomProcessSender`
 * (`rooms/messages/messages.service.ts`); từ nút "▶ Quy trình"/admin: route PF1.
 */
export type ProcessStartPort = {
  fromConversation(
    u: AuthUser,
    conversationId: string,
    bang: StartBang,
  ): Promise<ProcessRunSummary>;
  /**
   * ADM-FR-67 · nút "Chạy" ở admin (B3 `POST /process-defs/:id/run`): route đã kiểm role + quy trình bật của tenant
   * admin; PF1 tạo run `origin.kind="admin"` (201) hoặc ném 404/429 như trên. Bước 0: stub 404.
   */
  fromAdmin(u: AuthUser, defId: string, input: string): Promise<ProcessRunSummary>;
};

/** PF1 (D10) · sau COMMIT: tx người bắt đầu khoá run → kiểm lại quyền → `createRunTx` → `launch`. PF2 gọi sau trả lời. */
export type StageLauncher = { kick(runId: string): Promise<void> };

/**
 * PF3 · gọi TRONG tx của PF1/PF2 (sau khi ghi task/notice), trả `UserEvent[]` để người gọi phát SAU COMMIT
 * (`publishUserEvents`). Bước 0 = no-op (`[]`).
 */
export type ProcessNotifier = {
  taskOpened(tx: Tx, taskId: string): Promise<UserEvent[]>;
  taskClosed(tx: Tx, taskId: string): Promise<UserEvent[]>;
  runFinished(tx: Tx, runId: string): Promise<UserEvent[]>;
  /** CR-093 · bản lô cho vòng hết hạn: một câu chèn notice `run_finished` + một câu unread cho cả lô (A10, #90). */
  runsFinished(tx: Tx, runs: readonly FinishedRun[]): Promise<UserEvent[]>;
};

/** Run vừa kết thúc trong lô (hàng nguồn mang `tenant_id` — K3 lô, A11). */
export type FinishedRun = { id: string; tenantId: string; startedBy: string; processName: string };

export const NOOP_LAUNCHER: StageLauncher = { kick: async () => {} };

export const NOOP_NOTIFIER: ProcessNotifier = {
  taskOpened: async () => [],
  taskClosed: async () => [],
  runFinished: async () => [],
  runsFinished: async () => [],
};

/**
 * Phụ thuộc chung của module quy trình (`processes.mount.ts` dựng, mọi PF nhận). `now` = seam N3 (plan-contract §7.1);
 * `runsPerTenant` = `AppDeps.processRunsPerTenant` ?? `PROCESS_RUNS_PER_TENANT`.
 */
export type ProcessDeps = {
  db: Db;
  redis: Redis;
  config: ConfigCache;
  runs: RunService;
  /** PF1 · chạy job stage (agent đơn / từng thành viên nhóm) — `AgentRunner` dùng chung của instance (N4). */
  runner: AgentRunner;
  log: Logger;
  now: Clock;
  runsPerTenant: number;
  launcher: StageLauncher;
  notifier: ProcessNotifier;
  /** Sau COMMIT tx quy trình: đăng tin thread của run (`ThreadPoster.post`). */
  postThread(runId: string): Promise<number>;
  /** Cổng bắt đầu run (PF1) — B3 dùng cho "Chạy" từ admin; mount dựng từ `conversationStart`. */
  start: ProcessStartPort;
  /**
   * CR-056 · HUB-FR-115 · kho nội dung file (nối từ `AppDeps.attachments.storage`): `writeOutput` ghi blob output stage
   * vào đây (H2c-R05, `.part` → commit sau COMMIT tx) để stage kế tải được. Vắng ⇒ KHÔNG tạo hàng attachment output.
   */
  storage?: AttachmentStorage;
  signal?: AbortSignal;
  /** K1 · HUB-FR-133 · runtime KH (`app.h4a`): đích `## Tóm tắt` lúc start + bộ gửi `kh_writes`. Vắng ⇒ không KH. */
  kh?: KhRuntime;
  /** P-c2 · C13 · seam endpoint GitHub (ưu tiên hơn env `HUB_GITHUB_*`). Vắng ⇒ driver Áp coi như không mở PR được. */
  github?: { apiUrl: string; webHost: string };
  /** P-c2 · HUB-FR-129 · đọc khoá nguồn (`source_credential`) cho `openPullRequest`. Vắng ⇒ không mở PR (fail-closed). */
  secrets?: Pick<HubSecretReader, "useSecret">;
};
