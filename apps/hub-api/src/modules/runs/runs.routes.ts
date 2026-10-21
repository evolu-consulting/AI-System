// HUB-FR-41 · HUB-FR-42 · E12 `POST /conversations/:id/messages`, E13 `GET /runs/:id/events`, E14 `GET /runs/:id`
// (C1 plan §2.4). Thứ tự kiểm: auth (401, middleware gốc) → path uuid (404) → sở hữu (404) → body (400) → 409/410.
// Lỗi trước khi mở stream trả JSON. Parse bằng contract chat → gọi service → trả response. Không logic.
// H2a §5.1 (HUB-BR-01) + H2b §5.1 (P4): sau body → `routeMessage`: `/lệnh` → `prepareCommand` (404/422 `CMD_*` trước khi
// tạo run); `//…` → tin thường bỏ một `/`; `@tag` → `prepareMention` (404 `AGENT_NOT_FOUND` / 422 `CMD_MISSING_ARG` trước
// khi tạo run); `@@…` → tin thường bỏ một `@`.
// H2c-R10: sau body, **trước** router → `attachment_ids` qua `checkSendable` (404 `ATTACHMENT_NOT_FOUND{ids}`, không ghi
// gì); file gắn trong transaction tạo run (R11). Lệnh `/` nhận file của tin (`attachments`, R20).
import {
  AI_SURFACE_HEADER,
  FLOW_ID_HEADER,
  LAST_EVENT_ID_HEADER,
  LAST_EVENT_ID_QUERY,
  MESSAGE_ID_HEADER,
  type MessageContext,
  PROCESS_RUN_ID_HEADER,
  RUN_ID_HEADER,
  type SendMessageRequest,
  SendMessageRequestSchema,
  SSE_CONTENT_TYPE,
  surfaceOf,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthUser, AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { parseIdParam, parseJson } from "../../lib/http";
import { normalizeAttachmentIds } from "../attachments/run-files";
import type { RunFile } from "../attachments/run-files.rules";
import type { ConversationService } from "../conversations/conversations.service";
import type { MentionPlan, MentionRouted } from "../mention/mention.service";
import { routeMessage } from "../mention/mention-parse.rules";
import type { ContextLabeler } from "../packs/kit/application/context.ports";
import { type Bang, classifyBang } from "../processes/core/bang.rules";
import type { ProcessStartPort } from "../processes/core/ports";
import { parseLastEventId } from "./runs.rules";
import {
  type CommandRunStart,
  FORCE_ORCHESTRATOR,
  ORCHESTRATOR_TAG,
  type RunService,
  type StartedRun,
  UNTAGGED,
} from "./runs.service";
import { surfaceNote } from "./surface-context";

const NO_BANG: Bang = { kind: "none" };

/** Header chống đệm cho SSE (nginx `X-Accel-Buffering`). */
const SSE_HEADERS = {
  "Content-Type": SSE_CONTENT_TYPE,
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
} as const;

/**
 * H2a · lệnh `/` → run `kind=command` (ném `CMD_NOT_FOUND`/`CMD_MISSING_ARG`, không ghi gì). H2c: `attachments` = file của
 * tin (đã qua R09, thứ tự gửi; vắng/rỗng = không file).
 */
export type PrepareCommand = (
  u: AuthUser,
  req: { name: string; rest: string; ctx: MessageContext; attachments?: readonly RunFile[] },
) => Promise<CommandRunStart>;

/** H2b · tin có tag `@` → kế hoạch run (ném `AGENT_NOT_FOUND`/`CMD_MISSING_ARG`, không ghi gì). */
export type PrepareMention = (u: AuthUser, routed: MentionRouted) => Promise<MentionPlan>;

/** Chuẩn bị run E12 theo loại tin: lệnh `/` (H2a), tag `@` (H2b), quy trình `!` (P-a D14, vắng = cờ tắt). */
export type SendPrepare = {
  command: PrepareCommand;
  mention: PrepareMention;
  processStart?: ProcessStartPort;
  /** one-agent · nhãn bản ghi đang xem qua RLS gói của người gọi (registry tool gói); vắng ⇒ không nhắc bản ghi. */
  context?: ContextLabeler;
};

/** Lỗi tag/lệnh trả trước khi tạo run (không ghi gì). 1 tag → `direct`; ≥ 2 tag → Orchestrator thu hẹp (R04). */
async function startFor(
  runs: RunService,
  p: SendPrepare,
  c: { u: AuthUser; id: string; body: SendMessageRequest; files: RunFile[]; note: string | null },
): Promise<StartedRun> {
  const { u, id, body } = c;
  const o = c.note ? { systemNote: c.note } : undefined;
  const msg = routeMessage(body.content);
  if (msg.kind === "text") return runs.start(u, id, { ...body, content: msg.content }, UNTAGGED, o);
  if (msg.kind === "command") {
    const req = { name: msg.name, rest: msg.rest, ctx: body.context ?? {}, attachments: c.files };
    return runs.start(u, id, body, await p.command(u, req));
  }
  // chat-fast2 · `@orchestrator x` (cờ bật) ⇒ Orchestrator đủ AU; cờ tắt ⇒ như H2b (`AGENT_NOT_FOUND`).
  if (runs.fastRoute && msg.kind === "mention" && msg.tags.join() === ORCHESTRATOR_TAG) {
    if (msg.content === "")
      throw appError("CMD_MISSING_ARG", { missing: ["content"], invalid: [] });
    return runs.start(u, id, { ...body, content: msg.content }, FORCE_ORCHESTRATOR, o);
  }
  return runs.start(u, id, body, await p.mention(u, msg), o);
}

/** E12 · mount dưới `/conversations` (cạnh route E5–E11). Kiểm sở hữu hội thoại trước khi parse body (404 trước 400). */
export function sendMessageRoutes(
  conversations: ConversationService,
  runs: RunService,
  p: SendPrepare,
) {
  const r = new Hono<AuthVars>();
  r.post("/:id/messages", async (c) => {
    const id = parseIdParam(c);
    await conversations.get(c.var.user, id);
    const parsed = await parseJson(c, SendMessageRequestSchema);
    const u = c.var.user;
    // P-a D14 · `!key`/`!` sai ⇒ 202 `{process_run}` (không SSE, không lưu tin); `!!` ⇒ tin thường bỏ một `!`.
    const bang = p.processStart ? classifyBang(parsed.content) : NO_BANG;
    if (p.processStart && (bang.kind === "process" || bang.kind === "invalid")) {
      const run = await p.processStart.fromConversation(u, id, bang);
      c.header(PROCESS_RUN_ID_HEADER, run.id);
      return c.json({ process_run: run }, 202);
    }
    const content = bang.kind === "escaped" ? bang.content : parsed.content;
    // RV-7: id file chữ thường trước R09/R11 (`[U1,u1]` = trùng ⇒ 400).
    const ids = parsed.attachment_ids && normalizeAttachmentIds(parsed.attachment_ids);
    const body = { ...parsed, content, ...(ids && { attachment_ids: ids }) };
    const files = ids ? await runs.checkSendable(u, ids) : [];
    const surface = surfaceOf(c.req.header(AI_SURFACE_HEADER));
    // one-agent · khối ngữ cảnh theo nơi gửi + bản ghi đang xem (đã kiểm RLS) cho run `direct`.
    const note = await surfaceNote(p.context, u, body.context, surface);
    const s = await startFor(runs, p, { u, id, body, files, note });
    // usage-analytics · bề mặt gửi (dock Sổ Hợp Tác…) cho thống kê token; chỉ khi có header hợp lệ (1 câu SQL). `chat` =
    // mặc định của thống kê ⇒ không ghi.
    if (surface && surface !== "chat") await runs.noteSurface(u, s.runId, surface);
    return new Response(s.stream, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        [RUN_ID_HEADER]: s.runId,
        [FLOW_ID_HEADER]: s.flowId,
        [MESSAGE_ID_HEADER]: s.messageId,
      },
    });
  });
  return r;
}

/** E13, E14 · mount ở `/runs`. E15 (huỷ) thuộc B9. */
export function runRoutes(runs: RunService) {
  const r = new Hono<AuthVars>();
  r.get("/:id", async (c) => c.json(await runs.get(c.var.user, parseIdParam(c))));
  r.get("/:id/events", async (c) => {
    const id = parseIdParam(c);
    const after = parseLastEventId(
      c.req.header(LAST_EVENT_ID_HEADER),
      c.req.query(LAST_EVENT_ID_QUERY),
    );
    const stream = await runs.events(c.var.user, id, after);
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  });
  return r;
}
