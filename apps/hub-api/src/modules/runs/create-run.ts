// HUB-FR-41 · HUB-FR-94 · H2b-R16–R18 · E12: transaction `user` tạo run (plan H1 §5.1, H2b plan §5.1 bước 2, P7, P8,
// plan-db §2). Thứ tự khoá H1 §3.5 thêm **đầu** `[advisory user]`: advisory user → conversations → flows → `flowRunning`
// (409 `FLOW_BUSY`) → `countRunning` (429 `TOO_MANY_RUNS` + `Retry-After`) → runs → messages → tool_confirmations.
// Lỗi ném trong transaction ⇒ ROLLBACK (không flow/run/message — R17).
import {
  deriveTitle,
  RETRY_AFTER_HEADER,
  type SendMessageRequest,
  TOO_MANY_RUNS_RETRY_AFTER_S,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { appError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { isAgreeReply } from "../mcp/confirm.rules";
import { decideConfirmations } from "./confirm.repo";
import { overLimit } from "./run-limit.rules";
import * as repo from "./runs.repo";
import type { RunInfo } from "./sse/sse-writer";

export type Created = RunInfo & { userMessageId: string };

export type CreateRunInput = {
  run: Created;
  req: SendMessageRequest;
  configVersion: number;
  owner: string;
  /** H2a run `kind=command`. */
  command?: { commandId: string; featureId: string };
  /** H2b P7 · `orchestrated`: bản Orchestrator riêng đã chọn (null/vắng = mặc định). */
  orchestratorTenantId?: string | null;
  /** H2b R16 · = `AppDeps.maxConcurrentRuns`; vắng ⇒ không giới hạn (L1). */
  maxConcurrentRuns?: number;
  log: Pick<Logger, "info">;
};

const tooManyRuns = () =>
  appError("TOO_MANY_RUNS", undefined, {
    [RETRY_AFTER_HEADER]: String(TOO_MANY_RUNS_RETRY_AFTER_S),
  });

/** Flow có sẵn (404 / 409 `FLOW_BUSY`) hoặc flow mới. */
async function prepareFlow(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<void> {
  const r = p.run;
  if (!p.req.flow_id) {
    const title = deriveTitle(p.req.content);
    await repo.insertFlow(tx, o, { id: r.flowId, conversationId: r.conversationId, title });
    return;
  }
  const ok = await repo.touchFlow(tx, o, { conversationId: r.conversationId, flowId: r.flowId });
  if (!ok) throw appError("NOT_FOUND");
  if (await repo.flowRunning(tx, r.flowId)) throw appError("FLOW_BUSY");
}

/** R16/R17 · dưới khoá user nên số đếm ổn định; 429 log `info run-limit` (không nội dung tin, plan-errors §3). */
async function assertUnderLimit(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<void> {
  const limit = p.maxConcurrentRuns;
  if (limit === undefined) return;
  const running = await repo.countRunning(tx, o);
  if (!overLimit(running, limit)) return;
  p.log.info("run-limit", { tenant_id: o.tenantId, user_id: o.userId, running, limit });
  throw tooManyRuns();
}

/** §5.1 · một transaction `user` (gọi trong `withHubScope(user)`). 23505 `FLOW_RUNNING_UQ` do người gọi đổi `FLOW_BUSY`. */
export async function createRunTx(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<void> {
  const r = p.run;
  await repo.lockUserRuns(tx, o);
  if (!(await repo.touchConversation(tx, o, r.conversationId))) throw appError("NOT_FOUND");
  await prepareFlow(tx, o, p);
  await assertUnderLimit(tx, o, p);
  await repo.insertRun(tx, o, {
    id: r.id,
    conversationId: r.conversationId,
    flowId: r.flowId,
    configVersion: p.configVersion,
    userMessageId: r.userMessageId,
    answerMessageId: r.answerMessageId,
    owner: p.owner,
    locale: r.locale,
    ...(p.command
      ? { kind: "command" as const, commandId: p.command.commandId, featureId: p.command.featureId }
      : { orchestratorTenantId: p.orchestratorTenantId ?? null }),
  });
  await repo.insertMessage(tx, o, {
    id: r.userMessageId,
    conversationId: r.conversationId,
    flowId: r.flowId,
    role: "user",
    content: p.req.content,
    runId: r.id,
  });
  if (p.req.flow_id) {
    const agree = isAgreeReply(p.req.content);
    await decideConfirmations(tx, o, { flowId: r.flowId, runId: r.id, agree });
  }
}
