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
import { type ConfirmTag, decideConfirmations, preconfirm } from "./confirm.repo";
import { overLimit } from "./run-limit.rules";
import * as repo from "./runs.repo";
import type { RunInfo } from "./sse/sse-writer";

export type Created = RunInfo & { userMessageId: string };

/**
 * P-a D1, D3, D4 · run stage: bỏ giới hạn run đồng thời của user (D3 — giới hạn bằng run/tenant); `files` = output đã chốt +
 * bản nháp (D6, thay `attachment_ids` của tin); `preconfirm` = workflow `side_effect` đã được duyệt cho "Hành động thật".
 */
export type ProcessRunInput = {
  processRunId: string;
  stageRunId: string;
  teamRunId: string | null;
  files: RunFile[];
  preconfirm?: { agentId: string; workflowIds: readonly string[] };
};

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
  /** X2b D15 · agent chờ xác nhận không còn trong AU người xác nhận ⇒ xác nhận `declined` bất kể nội dung. */
  declineConfirm?: boolean;
  /** X2b D2 · run phòng (hội thoại nền); vắng ⇒ run C1 (hội thoại `room_id IS NULL`). */
  room?: boolean;
  /** P-a D1 · run stage quy trình (hội thoại nền quy trình, `runs.process_run_id/stage_run_id/team_run_id`). */
  process?: ProcessRunInput;
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
  if (p.declineConfirm) return { agree: false, tag: { kind: "none" } };
  const m = p.mention;
  if (!m) return { agree: isAgreeReply(p.req.content), tag: { kind: "none" } };
  const tag: ConfirmTag =
    m.kind === "direct" ? { kind: "single", agentId: m.agent.id } : { kind: "multi" };
  return { agree: isAgreeReply(m.content), tag };
}

/**
 * T19-perf vòng 2 · câu đã GỬI (pipeline) nhưng xét kết quả sau: gắn `catch` rỗng để lỗi của câu sau không thành
 * "unhandled" khi câu trước đã quyết lỗi (người gọi vẫn `await` đúng promise này theo thứ tự).
 */
function sent<T>(q: Promise<T>): Promise<T> {
  q.catch(() => {});
  return q;
}

/** Kiểm đã gửi: `check()` xét kết quả theo thứ tự (lỗi của câu trước thắng, như chạy tuần tự). */
type Check = () => Promise<void>;

/** Flow có sẵn (404 / 409 `FLOW_BUSY`) hoặc flow mới — gửi câu ngay, trả hàm xét kết quả. */
function sendFlow(tx: Tx, o: repo.Owner, p: CreateRunInput): Check {
  const r = p.run;
  if (!p.req.flow_id) {
    const title = deriveTitle(p.req.content);
    const ins = sent(
      repo.insertFlow(tx, o, { id: r.flowId, conversationId: r.conversationId, title }),
    );
    return () => ins;
  }
  const touched = sent(
    repo.touchFlow(tx, o, { conversationId: r.conversationId, flowId: r.flowId }),
  );
  const busy = sent(repo.flowRunning(tx, r.flowId));
  return async () => {
    if (!(await touched)) throw appError("NOT_FOUND");
    if (await busy) throw appError("FLOW_BUSY");
  };
}

/** R16/R17 · dưới khoá user nên số đếm ổn định; 429 log `info run-limit` (không nội dung tin, plan-errors §3). */
function sendLimit(tx: Tx, o: repo.Owner, p: CreateRunInput): Check {
  const limit = p.maxConcurrentRuns;
  if (limit === undefined || p.process) return async () => {};
  const count = sent(repo.countRunning(tx, o));
  return async () => {
    const running = await count;
    if (!overLimit(running, limit)) return;
    p.log.info("run-limit", { tenant_id: o.tenantId, user_id: o.userId, running, limit });
    throw tooManyRuns();
  };
}

const processCols = (x?: ProcessRunInput): Partial<repo.RunInsert> =>
  x ? { processRunId: x.processRunId, stageRunId: x.stageRunId, teamRunId: x.teamRunId } : {};

const runKind = (p: CreateRunInput): RunKind =>
  p.command ? "command" : p.direct ? "direct" : "orchestrated";

/**
 * H2c P7 · sau INSERT tin user: gắn file (R11, 404 ⇒ rollback) → tập file run (R14) → `runs.attachment_ids` khi ≠ ∅.
 * X2b2-D10 · run phòng ⇒ `[]` (không ứng viên H2c của flow nền): `RoomRunService` chọn file cửa sổ phòng sau tin gọi.
 */
async function attachFiles(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<RunFile[]> {
  const r = p.run;
  if (p.room) return [];
  if (p.process) return p.process.files; // `runs.attachment_ids` đã gửi cùng lô ở `sendRunWrites`
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
  await sendRunWrites(tx, o, p);
  const files = await attachFiles(tx, o, p);
  const r = p.run;
  if (p.req.flow_id) {
    await decideConfirmations(tx, o, { flowId: r.flowId, runId: r.id, ...confirmReply(p) });
  }
  const pre = p.process?.preconfirm;
  if (pre) await preconfirm(tx, o, { flowId: r.flowId, runId: r.id, ...pre });
  return files;
}

/**
 * T19-perf vòng 2 · khoá advisory → hội thoại → flow → đếm → INSERT run → INSERT tin GỬI LIỀN (pipeline, cùng tx ⇒ server
 * chạy đúng thứ tự gửi ⇒ thứ tự khoá §5.1 giữ nguyên, khoá advisory vẫn câu đầu), rồi xét kết quả THEO THỨ TỰ: 404 hội
 * thoại → 404/409 flow → 429 → lỗi INSERT (vd 23505 do người gọi đổi `FLOW_BUSY`). Câu sau một kiểm hỏng vẫn chạy nhưng
 * cùng ROLLBACK (không hàng nào còn lại — như tuần tự). ~6 round-trip ⇒ 1.
 */
async function sendRunWrites(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<void> {
  const r = p.run;
  const lock = sent(repo.lockUserRuns(tx, o));
  const bg = p.room ? "room" : p.process ? "process" : undefined;
  const conv = sent(repo.touchConversation(tx, o, r.conversationId, bg));
  const flow = sendFlow(tx, o, p);
  const limit = sendLimit(tx, o, p);
  const run = sent(insertRunOf(tx, o, p));
  const msg = sent(
    repo.insertMessage(tx, o, {
      id: r.userMessageId,
      conversationId: r.conversationId,
      flowId: r.flowId,
      role: "user",
      content: p.req.content,
      runId: r.id,
    }),
  );
  const fileIds = p.room ? [] : (p.process?.files.map((f) => f.id) ?? []);
  const setFiles = fileIds.length > 0 ? sent(repo.setRunFiles(tx, r.id, fileIds)) : undefined;
  await lock;
  if (!(await conv)) throw appError("NOT_FOUND");
  await flow();
  await limit();
  await run;
  await msg;
  await setFiles;
}

function insertRunOf(tx: Tx, o: repo.Owner, p: CreateRunInput): Promise<Date> {
  const r = p.run;
  return repo.insertRun(tx, o, {
    id: r.id,
    conversationId: r.conversationId,
    flowId: r.flowId,
    configVersion: p.configVersion,
    userMessageId: r.userMessageId,
    answerMessageId: r.answerMessageId,
    owner: p.owner,
    locale: r.locale,
    ...kindCols(p),
    ...processCols(p.process),
  });
}
