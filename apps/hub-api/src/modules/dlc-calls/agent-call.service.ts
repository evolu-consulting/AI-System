// dlc-engine · một bước DLC (tool `dlc-step` của engine quy trình) giao việc cho MỘT agent của Agent Hub và CHỜ kết quả: Hub mở
// run `@<agent>` như người bắt đầu lượt gõ trong hội thoại của lượt (người thấy bước trong Chat), đi đúng đường `direct` (quyền
// agent, hook, job Runtime), rồi đọc SSE. TƯƠNG TÁC: run kết thúc bằng câu hỏi (`ask` — agent cần người trả lời) ⇒ dò run kế của
// CHÍNH agent đó / cùng thread trong hội thoại (người trả lời trong thread hoặc tag agent) và đọc tiếp — tới khi một run kết thúc
// KHÔNG hỏi lại (xong). Hết hạn / huỷ (`signal`) ⇒ `timeout` (run vẫn còn). Trước đây gọi qua `/dify/agent-calls` + vé flow Dify.
import { createSseParser } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { AppError, appError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { routeMessage } from "../mention/mention-parse.rules";
import type { RunService } from "../runs/runs.service";
import type { PrepareMention } from "./ports";

export const AGENT_CALL_MAX_WAIT_S = 86_400;
const PROMPT_MAX = 60_000;
const POLL_MS = 2_000;
const MAX_TURNS = 40;

/** Người bắt đầu lượt + hội thoại của lượt (agent chạy và hỏi ở đó). */
export type CallWho = Pick<AuthUser, "userId" | "tenantId" | "role"> & { conversationId: string };
export type AgentCallResult = {
  status: "done" | "failed" | "timeout";
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
/** Một lượt gọi agent của bước: người + hội thoại, agent đích, log có ngữ cảnh run. */
type CallCtx = { w: CallWho; u: AuthUser; agentKey: string; log: Logger };

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

type RunRow = { id: string; flow_id: string; agent_id: string | null; created_at: string };

export type AgentCallDeps = {
  db: Db;
  runs: RunService;
  prepareMention: PrepareMention;
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

  /** Lời user ở run kế (tin nhắn của run đó) — để ghi vào `dialog`. */
  async #userText(runId: string): Promise<string> {
    const [r] = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute<{ content: string }>(sql`select m.content from hub.runs r join hub.messages m
        on m.id = r.user_message_id where r.id = ${runId}::uuid`),
    );
    return r?.content ?? "";
  }

  /** Giao `prompt` cho `@agentKey` trong hội thoại của `w`; chờ tới khi agent xong (kể cả các lượt hỏi người). */
  async call(
    w: CallWho,
    agentKey: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AgentCallResult> {
    const u: AuthUser = { userId: w.userId, tenantId: w.tenantId, role: w.role };
    const content = `@${agentKey} ${prompt.slice(0, PROMPT_MAX)}`;
    const msg = routeMessage(content);
    if (msg.kind !== "mention" || msg.tags.length !== 1) throw appError("AGENT_NOT_FOUND");
    const plan = await this.d.prepareMention(u, msg);
    // Mỗi lần bước gọi agent = một việc độc lập (prompt đã mang đủ spec / plan / việc): bỏ phiên Claude cũ của agent trong
    // hội thoại để không kéo theo transcript mọi bước trước (lượt hỏi–đáp trong CÙNG lần gọi vẫn nối tiếp phiên mới).
    if (plan.kind === "direct") await this.#freshSession(w, plan.agent.id);
    let started: Awaited<ReturnType<RunService["start"]>>;
    try {
      started = await this.d.runs.start(u, w.conversationId, { content }, plan);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw appError("INTERNAL_ERROR");
    }
    const log = this.d.log.child({
      run_id: started.runId,
      tenant_id: w.tenantId,
      user_id: w.userId,
    });
    const limit = AbortSignal.timeout(AGENT_CALL_MAX_WAIT_S * 1000);
    const sig = signal ? AbortSignal.any([signal, limit]) : limit;
    return this.#follow({ w, u, agentKey, log }, started, sig);
  }

  /** Xoá phiên CLI đã lưu của agent trong hội thoại ⇒ job kế chạy phiên mới (Runtime lưu phiên mới khi xong). */
  async #freshSession(w: CallWho, agentId: string): Promise<void> {
    await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute(sql`delete from hub.cli_sessions where conversation_id = ${w.conversationId}::uuid
        and agent_id = ${agentId}::uuid and tenant_id = ${w.tenantId}::uuid`),
    );
  }

  async #follow(
    c: CallCtx,
    started: { runId: string; flowId: string; stream: ReadableStream<Uint8Array> },
    signal: AbortSignal,
  ): Promise<AgentCallResult> {
    const { w, agentKey, log } = c;
    log.info("agent-call-started", { agent: agentKey });
    const dialog: Dialog = [];
    let cur = await this.#run(started.runId);
    let stream = started.stream;
    const base = (): Base => ({
      run_id: cur?.id ?? started.runId,
      flow_id: cur?.flow_id ?? started.flowId,
      conversation_id: w.conversationId,
      turns: dialog.length,
      dialog,
    });
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const end = await waitRun(stream, signal);
      if (end.kind !== "finished" || !end.asked || !cur) {
        log.info("agent-call-ended", { agent: agentKey, outcome: end.kind, turns: dialog.length });
        return endResult(end, base());
      }
      const question = end.content.slice(0, 4000);
      log.info("agent-call-waiting", { agent: agentKey, turn });
      const nxt = await this.#nextRun(w.conversationId, cur, signal);
      if (!nxt) break;
      dialog.push({ question, answer: (await this.#userText(nxt.id)).slice(0, 4000) });
      cur = nxt;
      stream = await this.d.runs.events(c.u, nxt.id, 0);
    }
    return { status: "timeout", text: "", ...base() };
  }
}
