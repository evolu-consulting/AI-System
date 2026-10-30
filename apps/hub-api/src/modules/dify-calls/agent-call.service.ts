// dlc-dify · `POST /dify/agent-calls`: một node của flow Dify (vd một bước quy trình DLC) giao việc cho MỘT agent của Agent
// Hub và CHỜ kết quả. Vé (`tickets.ts`) ⇒ user + hội thoại đã cấp vé; Hub mở một run `@<agent>` như user gõ trong hội thoại
// đó (flow mới — người dùng thấy bước trong Chat), đi đúng đường `direct` (quyền agent, hook, job Runtime), rồi đọc SSE.
// TƯƠNG TÁC (pause/resume): run kết thúc bằng câu hỏi (`ask` — agent cần user trả lời / xin duyệt) ⇒ request của Dify VẪN
// giữ (flow Dify đứng chờ); Hub ghi "đang chờ" (Redis, cho `/dify/answers`) rồi dò run kế của CHÍNH agent đó trong hội
// thoại (user tag agent, trả lời trong thread của bước, hoặc `dlc-agent` chuyển lời qua `/dify/answers`) và đọc tiếp — tới
// khi một run kết thúc KHÔNG hỏi lại (xong) ⇒ trả kết quả cho Dify, flow chạy tiếp. Hết hạn ⇒ `timeout` (run vẫn còn).
import { createSseParser } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { AppError, appError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { routeMessage } from "../mention/mention-parse.rules";
import type { RunService } from "../runs/runs.service";
import type { PrepareMention } from "./ports";
import type { FlowTicket, FlowTickets } from "./tickets";

export const AGENT_CALL_MAX_WAIT_S = 86_400;
const PROMPT_MAX = 60_000;
const POLL_MS = 2_000;
const MAX_TURNS = 40;
const WAIT_TTL_S = 86_400;

export type AgentCallRequest = {
  agent_key: string;
  prompt: string;
  wait_s?: number;
  skip?: boolean;
};
export type AgentCallResult = {
  status: "done" | "failed" | "timeout" | "skipped";
  text: string;
  run_id: string;
  flow_id: string;
  conversation_id: string;
  /** Số lượt hỏi–đáp với user trước khi xong (0 = không hỏi). */
  turns: number;
  /** Các câu agent đã hỏi + lời user trả (để bước sau biết quyết định của người). */
  dialog: { question: string; answer: string }[];
  error?: { code: string; message: string };
};

type Ended =
  | { kind: "finished"; content: string; asked: boolean }
  | { kind: "failed"; code: string; message: string }
  | { kind: "timeout"; partial: string };

type Acc = { partial: string; asked: boolean };
type Dialog = AgentCallResult["dialog"];
type Base = Pick<AgentCallResult, "run_id" | "flow_id" | "conversation_id" | "turns" | "dialog">;
/** Một lượt gọi agent của flow: vé (user + hội thoại), người gọi, agent đích, log có ngữ cảnh run. */
type CallCtx = { t: FlowTicket; u: AuthUser; agentKey: string; log: Logger };

/** Kết quả trả flow khi run agent kết thúc không hỏi thêm (xong / lỗi / hết hạn). */
function endResult(end: Ended, base: Base): AgentCallResult {
  if (end.kind === "finished") return { status: "done", text: end.content, ...base };
  if (end.kind === "failed")
    return { status: "failed", text: "", ...base, error: { code: end.code, message: end.message } };
  return { status: "timeout", text: end.partial, ...base };
}

/** Một khung SSE của run: `delta` cộng dồn; `ask` ⇒ run này là câu hỏi; `run.finished`/`run.failed` ⇒ kết thúc. */
function onRunEvent(acc: Acc, event: string, data: string): Ended | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (event === "delta" && typeof d.text === "string") acc.partial += d.text;
  if (event === "ask") acc.asked = true;
  if (event === "run.finished")
    return {
      kind: "finished",
      content: typeof d.content === "string" ? d.content : acc.partial,
      asked: acc.asked,
    };
  if (event === "run.failed")
    return {
      kind: "failed",
      code: String(d.code ?? "UPSTREAM_ERROR"),
      message: String(d.message ?? ""),
    };
  return null;
}

/** Đọc SSE của run tới sự kiện kết thúc; `signal` (hạn chờ) ⇒ `timeout` với phần đã phát. */
export async function waitRun(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Ended> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const acc: Acc = { partial: "", asked: false };
  let end: Ended | null = null;
  const feed = createSseParser((e) => {
    end ??= onRunEvent(acc, e.event, e.data);
  });
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!end) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(dec.decode(value, { stream: true }));
    }
  } catch {
    /* huỷ đọc khi hết hạn */
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (end) void reader.cancel().catch(() => {});
  }
  return end ?? { kind: "timeout", partial: acc.partial };
}

export type Waiting = {
  agent_key: string;
  agent_id: string | null;
  flow_id: string;
  run_id: string;
  question: string;
  since: string;
};
export const waitKey = (conversationId: string) => `hub:dlc-wait:${conversationId}`;

type RunRow = { id: string; flow_id: string; agent_id: string | null; created_at: string };

export type AgentCallDeps = {
  db: Db;
  redis: Pick<Redis, "get" | "set" | "del">;
  runs: RunService;
  prepareMention: PrepareMention;
  tickets: FlowTickets;
  log: Logger;
};

export class AgentCallService {
  constructor(private readonly d: AgentCallDeps) {}

  async #run(id: string): Promise<RunRow | null> {
    const [r] = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute<RunRow>(sql`select id, flow_id, agent_id, started_at::text as created_at
        from hub.runs where id = ${id}::uuid`),
    );
    return r ?? null;
  }

  /** Run kế sau `prev` trong hội thoại: của cùng agent, hoặc trong cùng thread (flow) của bước. */
  async #nextRun(
    conversationId: string,
    prev: RunRow,
    signal: AbortSignal,
  ): Promise<RunRow | null> {
    while (!signal.aborted) {
      const [r] = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
        tx.execute<RunRow>(sql`select id, flow_id, agent_id, started_at::text as created_at from hub.runs
          where conversation_id = ${conversationId}::uuid and started_at > ${prev.created_at}::timestamptz
            and id <> ${prev.id}::uuid
            and (flow_id = ${prev.flow_id}::uuid or (${prev.agent_id}::uuid is not null and agent_id = ${prev.agent_id}::uuid))
          order by started_at limit 1`),
      );
      if (r) return r;
      await Bun.sleep(POLL_MS);
    }
    return null;
  }

  async #markWaiting(conversationId: string, w: Waiting | null, agentKey: string): Promise<void> {
    const key = waitKey(conversationId);
    const cur = JSON.parse((await this.d.redis.get(key)) ?? "[]") as Waiting[];
    const rest = cur.filter((x) => x.agent_key !== agentKey);
    const next = w ? [...rest, w] : rest;
    if (next.length === 0) await this.d.redis.del(key);
    else await this.d.redis.set(key, JSON.stringify(next), "EX", WAIT_TTL_S);
  }

  /** Lời user ở run kế (tin nhắn của run đó) — để ghi vào `dialog`. */
  async #userText(runId: string): Promise<string> {
    const [r] = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute<{ content: string }>(sql`select m.content from hub.runs r join hub.messages m
        on m.id = r.user_message_id where r.id = ${runId}::uuid`),
    );
    return r?.content ?? "";
  }

  async call(ticket: string, b: AgentCallRequest): Promise<AgentCallResult> {
    const t = await this.d.tickets.resolve(ticket);
    if (!t) throw appError("AUTH_EXPIRED");
    const empty = {
      run_id: "",
      flow_id: "",
      conversation_id: t.conversationId,
      turns: 0,
      dialog: [],
    };
    if (b.skip || !b.agent_key.trim()) return { status: "skipped", text: "", ...empty };
    const u: AuthUser = { userId: t.userId, tenantId: t.tenantId, role: t.role };
    const content = `@${b.agent_key} ${b.prompt.slice(0, PROMPT_MAX)}`;
    const msg = routeMessage(content);
    if (msg.kind !== "mention" || msg.tags.length !== 1) throw appError("AGENT_NOT_FOUND");
    const plan = await this.d.prepareMention(u, msg);
    // Mỗi lần flow gọi agent = một bước độc lập (prompt đã mang đủ spec / plan / việc): bỏ phiên Claude cũ của agent
    // trong hội thoại để không kéo theo transcript mọi bước trước (lượt hỏi–đáp trong CÙNG lần gọi vẫn nối tiếp phiên mới).
    if (plan.kind === "direct") await this.#freshSession(t, plan.agent.id);
    let started: Awaited<ReturnType<RunService["start"]>>;
    try {
      started = await this.d.runs.start(u, t.conversationId, { content }, plan);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw appError("INTERNAL_ERROR");
    }
    const waitS = Math.min(Math.max(b.wait_s ?? AGENT_CALL_MAX_WAIT_S, 10), AGENT_CALL_MAX_WAIT_S);
    const log = this.d.log.child({
      run_id: started.runId,
      tenant_id: t.tenantId,
      user_id: t.userId,
    });
    const c: CallCtx = { t, u, agentKey: b.agent_key, log };
    return this.#follow(c, started, AbortSignal.timeout(waitS * 1000));
  }

  /** Xoá phiên CLI đã lưu của agent trong hội thoại ⇒ job kế chạy phiên mới (Runtime lưu phiên mới khi xong). */
  async #freshSession(t: FlowTicket, agentId: string): Promise<void> {
    await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute(sql`delete from hub.cli_sessions where conversation_id = ${t.conversationId}::uuid
        and agent_id = ${agentId}::uuid and tenant_id = ${t.tenantId}::uuid`),
    );
  }

  /** Agent hỏi lại / xin duyệt ⇒ flow Dify đứng chờ user trả lời trong Chat; trả run kế (lượt trả lời) hoặc null. */
  async #awaitAnswer(c: CallCtx, cur: RunRow, question: string, signal: AbortSignal) {
    const waiting: Waiting = {
      agent_key: c.agentKey,
      agent_id: cur.agent_id,
      flow_id: cur.flow_id,
      run_id: cur.id,
      question,
      since: new Date().toISOString(),
    };
    await this.#markWaiting(c.t.conversationId, waiting, c.agentKey);
    return this.#nextRun(c.t.conversationId, cur, signal);
  }

  async #follow(
    c: CallCtx,
    started: { runId: string; flowId: string; stream: ReadableStream<Uint8Array> },
    signal: AbortSignal,
  ): Promise<AgentCallResult> {
    const { t, agentKey, log } = c;
    log.info("agent-call-started", { agent: agentKey, workflow: t.workflowKey });
    const dialog: Dialog = [];
    let cur = await this.#run(started.runId);
    let stream = started.stream;
    const base = (): Base => ({
      run_id: cur?.id ?? started.runId,
      flow_id: cur?.flow_id ?? started.flowId,
      conversation_id: t.conversationId,
      turns: dialog.length,
      dialog,
    });
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const end = await waitRun(stream, signal);
      if (end.kind !== "finished" || !end.asked || !cur) {
        await this.#markWaiting(t.conversationId, null, agentKey).catch(() => {});
        log.info("agent-call-ended", { agent: agentKey, outcome: end.kind, turns: dialog.length });
        return endResult(end, base());
      }
      const question = end.content.slice(0, 4000);
      log.info("agent-call-waiting", { agent: agentKey, turn });
      const nxt = await this.#awaitAnswer(c, cur, question, signal);
      if (!nxt) break;
      dialog.push({ question, answer: (await this.#userText(nxt.id)).slice(0, 4000) });
      cur = nxt;
      stream = await this.d.runs.events(c.u, nxt.id, 0);
    }
    await this.#markWaiting(t.conversationId, null, agentKey).catch(() => {});
    return { status: "timeout", text: "", ...base() };
  }

  /** `/dify/answers`: `dlc-agent` chuyển lời user cho bước đang chờ (agent chỉ định hoặc bước chờ gần nhất). */
  async answer(
    ticket: string,
    b: { answer: string; agent_key?: string },
  ): Promise<{ forwarded_to: string | null; run_id: string | null; waiting: Waiting[] }> {
    const t = await this.d.tickets.resolve(ticket);
    if (!t) throw appError("AUTH_EXPIRED");
    const all = JSON.parse(
      (await this.d.redis.get(waitKey(t.conversationId))) ?? "[]",
    ) as Waiting[];
    const w = b.agent_key ? all.find((x) => x.agent_key === b.agent_key) : all[all.length - 1];
    if (!w || !b.answer.trim()) return { forwarded_to: null, run_id: null, waiting: all };
    const u: AuthUser = { userId: t.userId, tenantId: t.tenantId, role: t.role };
    const content = `@${w.agent_key} ${b.answer.slice(0, PROMPT_MAX)}`;
    const msg = routeMessage(content);
    if (msg.kind !== "mention") throw appError("AGENT_NOT_FOUND");
    const plan = await this.d.prepareMention(u, msg);
    const s = await this.d.runs.start(u, t.conversationId, { content, flow_id: w.flow_id }, plan);
    void s.stream.cancel().catch(() => {});
    return { forwarded_to: w.agent_key, run_id: s.runId, waiting: all };
  }

  /** Bước đang chờ user của hội thoại (cho `dlc-agent` biết có ai đang hỏi). */
  async waiting(ticket: string): Promise<Waiting[]> {
    const t = await this.d.tickets.resolve(ticket);
    if (!t) throw appError("AUTH_EXPIRED");
    return JSON.parse((await this.d.redis.get(waitKey(t.conversationId))) ?? "[]") as Waiting[];
  }
}
