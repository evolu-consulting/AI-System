// HUB-FR-41 · HUB-FR-94 · H2b-R16–R18 · E12: transaction `user` tạo run (plan H1 §5.1, H2b plan §5.1 bước 2, P7, P8,
// plan-db §2). Thứ tự khoá H1 §3.5 thêm **đầu** `[advisory user]`: advisory user → conversations → flows → `flowRunning`
// (409 `FLOW_BUSY`) → `countRunning` (429 `TOO_MANY_RUNS` + `Retry-After`) → runs → messages → attachments (H2c P8:
// gắn R11 + tập file R14 → `runs.attachment_ids`) → tool_confirmations.
// Lỗi ném trong transaction ⇒ ROLLBACK (không flow/run/message, file chưa gắn — R17, H2c-R11).
import {
  deriveTitle,
  RETRY_AFTER_HEADER,
  type Responder,
  type SendMessageRequest,
  TOO_MANY_RUNS_RETRY_AFTER_S,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { appError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { bindRunFiles, type RunKind } from "../attachments/run-files";
import type { RunFile } from "../attachments/run-files.rules";
import { isAgreeReply } from "../mcp/confirm.rules";
import type { MentionPlan } from "../mention/mention.service";
import { type ConfirmTag, decideConfirmations } from "./confirm.repo";
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
  /** H2b P1 · run `direct`: agent + `responder` chốt lúc tạo run (không `orchestrator_tenant_id`). */
  direct?: { agentId: string; responder: Responder };
  /** H2b R12 · tin có tag `@` (đã phân giải): xác nhận so trên nội dung R04 + tag; vắng = không tag (cả tin). */
  mention?: MentionPlan;
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

/** Cột theo loại run: `command` (H2a) · `direct` (H2b P1) · `orchestrated` (+ bản Orchestrator riêng, P7). */
function kindCols(p: CreateRunInput): Partial<repo.RunInsert> {
  if (p.command) {
    const { commandId, featureId } = p.command;
    return { kind: "command", commandId, featureId };
  }
  if (p.direct) {
    const { agentId, responder } = p.direct;
    return { kind: "direct", agentId, responderKey: responder.key, responderName: responder.name };
  }
  return { orchestratorTenantId: p.orchestratorTenantId ?? null };
}

/** R12 · `agree` trên nội dung R04 (không tag: cả tin); một tag luôn là `direct` (R06), ≥ 2 tag là `orchestrated`. */
function confirmReply(p: CreateRunInput): { agree: boolean; tag: ConfirmTag } {
  const m = p.mention;
  if (!m) return { agree: isAgreeReply(p.req.content), tag: { kind: "none" } };
  const tag: ConfirmTag =
    m.kind === "direct" ? { kind: "single", agentId: m.agent.id } : { kind: "multi" };
  return { agree: isAgreeReply(m.content), tag };
}

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

const runKind = (p: CreateRunInput): RunKind =>
  p.command ? "command" : p.direct ? "direct" : "orchestrated";

/** H2c P7 · sau INSERT tin user: gắn file (R11, 404 ⇒ rollback) → tập file run (R14) → `runs.attachment_ids` khi ≠ ∅. */
async function attachFiles(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<RunFile[]> {
  const r = p.run;
  const files = await bindRunFiles(tx, o, {
    ids: p.req.attachment_ids,
    newFlow: !p.req.flow_id,
    kind: runKind(p),
    messageId: r.userMessageId,
    conversationId: r.conversationId,
    flowId: r.flowId,
  });
  if (files.length > 0)
    await repo.setRunFiles(
      tx,
      r.id,
      files.map((f) => f.id),
    );
  return files;
}

/**
 * §5.1 · một transaction `user` (gọi trong `withHubScope(user)`). 23505 `FLOW_RUNNING_UQ` do người gọi đổi `FLOW_BUSY`.
 * Trả tập file của run (H2c-R14, `RunContext.files`).
 */
export async function createRunTx(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<RunFile[]> {
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
    ...kindCols(p),
  });
  await repo.insertMessage(tx, o, {
    id: r.userMessageId,
    conversationId: r.conversationId,
    flowId: r.flowId,
    role: "user",
    content: p.req.content,
    runId: r.id,
  });
  const files = await attachFiles(tx, o, p);
  if (p.req.flow_id) {
    await decideConfirmations(tx, o, { flowId: r.flowId, runId: r.id, ...confirmReply(p) });
  }
  return files;
}
