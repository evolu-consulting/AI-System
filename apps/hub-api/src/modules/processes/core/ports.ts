// HUB-FR-105 · HUB-FR-110 · HUB-FR-112 · cổng giữa các PF (plan §9 "Ports", plan-step0 §1): PF gọi nhau qua đây, không
// import file của PF khác. Bước 0 dựng bản no-op/stub; PF điền thân trong thư mục của mình.
import type { ProcessRunSummary } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import type { UserEvent } from "../../../lib/user-stream";
import type { ConfigCache } from "../../config/config.service";
import type { RunService } from "../../runs/runs.service";
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
};

export const NOOP_LAUNCHER: StageLauncher = { kick: async () => {} };

export const NOOP_NOTIFIER: ProcessNotifier = {
  taskOpened: async () => [],
  taskClosed: async () => [],
  runFinished: async () => [],
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
  log: Logger;
  now: Clock;
  runsPerTenant: number;
  launcher: StageLauncher;
  notifier: ProcessNotifier;
  /** Sau COMMIT tx quy trình: đăng tin thread của run (`ThreadPoster.post`). */
  postThread(runId: string): Promise<number>;
  signal?: AbortSignal;
};
