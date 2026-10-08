// HUB-FR-40 · HUB-FR-45 · HUB-BR-14 · nghiệp vụ E5–E11 (C1 plan §2.4). Mọi đọc/ghi qua `withHubScope(user)` (D2);
// không thấy (khác chủ / khác tenant / đã xoá / không có) → cùng một 404 `NOT_FOUND` (H1-R03). Không biết HTTP.
// E9 ở đây xoá mềm hội thoại; huỷ run đang chạy cắm qua `remove(…, inTx)` (B9 `runs/close/cancel.service`, plan §5.7).
import {
  type ChatPage,
  type Conversation,
  type ConversationListQuery,
  type Flow,
  type FlowListQuery,
  foldVi,
  type Message,
  type MessageListQuery,
  type Responder,
  type RunSummary,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import * as repo from "./conversations.repo";
import {
  decodeCursor,
  type MessageRow,
  type PageKey,
  takePage,
  titleSearchPattern,
  toAttachmentRef,
  toConversation,
  toMessage,
  toRunSummary,
} from "./conversations.rules";
import * as threads from "./flows.repo";

type Owner = repo.Owner;

function cursorOf(raw: string | undefined): PageKey | undefined {
  if (raw === undefined) return undefined;
  const key = decodeCursor(raw);
  if (!key) {
    throw validationError([{ path: ["cursor"], code: "custom", message: "Invalid cursor" }]);
  }
  return key;
}

const notFound = () => appError("NOT_FOUND");

async function requireLive(tx: Tx, o: Owner, id: string) {
  const row = await repo.findConversation(tx, o, id);
  if (!row) throw notFound();
  return row;
}

type RunView = { summary: RunSummary | null; responder: Responder | null };

/** Tóm tắt run (run đang chạy → null) + `responder` (run `direct`, P1) cho các tin assistant. */
async function runSummaries(
  tx: Tx,
  o: Owner,
  rows: readonly MessageRow[],
): Promise<Map<string, RunView>> {
  const ids = [
    ...new Set(rows.flatMap((r) => (r.role === "assistant" && r.runId ? [r.runId] : []))),
  ];
  const { runs, steps } = await threads.runsWithSteps(tx, o, ids);
  return new Map(
    runs.map((r) => [
      r.id,
      {
        summary: toRunSummary(
          r,
          steps.filter((s) => s.runId === r.id),
        ),
        responder: r.responder ?? null,
      },
    ]),
  );
}

async function toMessages(tx: Tx, o: Owner, rows: readonly MessageRow[]): Promise<Message[]> {
  const sums = await runSummaries(tx, o, rows);
  const files = await repo.messageAttachments(
    tx,
    o,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const v = r.runId ? sums.get(r.runId) : undefined;
    const refs = files.get(r.id)?.map(toAttachmentRef);
    return toMessage(r, v?.summary ?? null, v?.responder, refs);
  });
}

async function toFlows(tx: Tx, o: Owner, rows: readonly threads.FlowRow[]): Promise<Flow[]> {
  const firsts = await threads.firstMessages(
    tx,
    o,
    rows.map((r) => r.id),
  );
  const msgs = await toMessages(tx, o, firsts);
  const pick = (flowId: string, role: Message["role"]) =>
    msgs.find((x) => x.flow_id === flowId && x.role === role);
  // Flow luôn có tin user đầu (E12 ghi cùng transaction); thiếu = dữ liệu dở → không trả flow sai contract.
  return rows.flatMap((r) => {
    const question = pick(r.id, "user");
    if (!question) return [];
    return [
      {
        id: r.id,
        conversation_id: r.conversationId,
        title: r.title,
        created_at: r.createdAt.toISOString(),
        last_active_at: r.lastActiveAt.toISOString(),
        message_count: Math.max(1, r.messageCount),
        active_run_id: r.activeRunId,
        preview: { question, answer: pick(r.id, "assistant") ?? null },
      },
    ];
  });
}

/** E5 · `updated_at` giảm, hoà → `id` giảm; `q` khớp `title_norm` (không dấu). */
async function conversationPage(
  tx: Tx,
  o: Owner,
  q: ConversationListQuery,
): Promise<ChatPage<Conversation>> {
  const pattern = q.q === undefined ? undefined : titleSearchPattern(q.q);
  const after = cursorOf(q.cursor);
  const rows = await repo.listConversations(tx, o, { pattern, after, limit: q.limit });
  const page = takePage(rows, q.limit);
  return { items: page.items.map(toConversation), next_cursor: page.next };
}

/** E10 · flow `created_at` tăng (CR-051 `order=desc`: giảm), `next_cursor` = trang sau. */
async function flowPage(tx: Tx, o: Owner, id: string, q: FlowListQuery): Promise<ChatPage<Flow>> {
  await requireLive(tx, o, id);
  const after = cursorOf(q.cursor);
  const rows = await threads.listFlows(tx, o, {
    conversationId: id,
    after,
    limit: q.limit,
    desc: q.order === "desc",
  });
  const page = takePage(rows, q.limit);
  return { items: await toFlows(tx, o, page.items), next_cursor: page.next };
}

/** E11 · trang = `limit` tin mới nhất (trước cursor), `items` tăng dần; `next_cursor` = trang cũ hơn. */
async function messagePage(
  tx: Tx,
  o: Owner,
  id: string,
  q: MessageListQuery,
): Promise<ChatPage<Message>> {
  await requireLive(tx, o, id);
  if (q.flow_id && !(await threads.flowInConversation(tx, o, id, q.flow_id))) throw notFound();
  const before = cursorOf(q.cursor);
  const rows = await threads.listMessagesDesc(tx, o, {
    conversationId: id,
    flowId: q.flow_id,
    before,
    limit: q.limit,
  });
  const page = takePage(rows, q.limit);
  return { items: await toMessages(tx, o, [...page.items].reverse()), next_cursor: page.next };
}

export type ConversationService = ReturnType<typeof conversationService>;

export function conversationService(db: Db) {
  const scoped = <T>(u: AuthUser, fn: (tx: Tx, o: Owner) => Promise<T>): Promise<T> => {
    const o = { tenantId: u.tenantId, userId: u.userId };
    return withHubScope(db, { kind: "user", ...o }, (tx) => fn(tx, o));
  };
  const titled = (title: string) => ({ title, titleNorm: foldVi(title) });

  return {
    list: (u: AuthUser, q: ConversationListQuery) =>
      scoped(u, (tx, o) => conversationPage(tx, o, q)),
    /** E7 (và kiểm sở hữu trước khi parse body/query của E8/E10/E11). */
    get: (u: AuthUser, id: string): Promise<Conversation> =>
      scoped(u, async (tx, o) => toConversation(await requireLive(tx, o, id))),
    /** E6 */
    create: (u: AuthUser, title: string): Promise<Conversation> =>
      scoped(u, async (tx, o) =>
        toConversation(await repo.insertConversation(tx, o, titled(title))),
      ),
    /** E8 · không đổi tiêu đề flow (C1 plan §2.6). */
    rename: (u: AuthUser, id: string, title: string): Promise<Conversation> =>
      scoped(u, async (tx, o) => {
        if (!(await repo.renameConversation(tx, o, id, titled(title)))) throw notFound();
        return toConversation(await requireLive(tx, o, id));
      }),
    /**
     * E9 · xoá mềm; lần 2 → 404. `inTx` chạy cùng transaction ngay sau khi khoá hội thoại (huỷ run B9, plan §5.7);
     * chỉ được làm việc DB (transaction có thể chạy lại khi deadlock).
     */
    remove: <T = void>(
      u: AuthUser,
      id: string,
      inTx?: (tx: Tx, o: Owner) => Promise<T>,
    ): Promise<T | undefined> =>
      scoped(u, async (tx, o) => {
        if (!(await repo.softDeleteConversation(tx, o, id))) throw notFound();
        return inTx?.(tx, o);
      }),
    flows: (u: AuthUser, id: string, q: FlowListQuery) =>
      scoped(u, (tx, o) => flowPage(tx, o, id, q)),
    messages: (u: AuthUser, id: string, q: MessageListQuery) =>
      scoped(u, (tx, o) => messagePage(tx, o, id, q)),
  };
}
