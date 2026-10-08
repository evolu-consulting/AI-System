// HUB-FR-101 · HUB-FR-28 · HUB-FR-95 · X2b `RoomRunPoster` — đăng tin agent vào phòng (plan D3, D4, D12, D14, §5 hàng
// Đăng/Reconcile, §7). tx2 scope `system` SAU khi run dừng (tx1 C1 đã COMMIT): hook `onClosed` (SseWriter/CancelService)
// + vòng `reconcile` 5 s (bù instance chết giữa hai tx, sweeper/lease không gọi hook). Run còn `running` ⇒ `already`.
// Idempotent ở definer (`runs.room_posted_at`) ⇒ kết quả trễ sau huỷ bị bỏ. Sự kiện chỉ phát khi reason ≠ `already`.
import { CHAT_CONTENT_MAX } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { Redis } from "../../../lib/redis";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import { type RoomMessageRow, toRoomMessage } from "../rooms.map";
import { agentMessageView } from "./room-agent.rules";
import * as repo from "./room-post.repo";
import { type AgentData, rowFor } from "./room-post.view";
import { agentMessageEvents, runClosedEvents } from "./room-run-events";

export const ROOM_RECONCILE_MS = 5_000;
const SYSTEM = { kind: "system" } as const;
const BACKOFF_MAX_MS = 10 * 60_000;
const BACKOFF_CAP = 1_000;
/** Agent trả rỗng: `room_messages.content` cần 1–16000 ký tự. */
const EMPTY_CONTENT = "…";

export type RoomPosterDeps = { db: Db; redis?: Pick<Redis, "pipeline">; log: Logger };
type Posted = { reason: repo.PostResult["reason"]; events: UserEvent[] };
type View = ReturnType<typeof agentMessageView>;

function metaOf(o: repo.RunOutcomeRow, v: View): repo.PostMeta {
  return {
    run_status: v.runStatus,
    ...(v.waitKind && { wait_kind: v.waitKind }),
    ...(v.waitKind === "need_input" && v.ask && { ask: v.ask }),
    step_count: o.stepCount,
    run_ms: o.runMs,
  };
}

/** D3 · bản công khai (mọi thành viên) và bản của người gọi (nội dung + `ask` riêng của `side_effect`). */
function messagesOf(o: repo.RunOutcomeRow, v: View, content: string, res: repo.PostResult) {
  const row: RoomMessageRow = {
    ...{ id: o.answerMessageId, roomId: o.roomId, seq: res.seq ?? 0, senderType: "agent" },
    sender: { id: o.senderId, displayName: null, username: null },
    ...{ content, clientMsgId: null, createdAt: res.createdAt ?? new Date() },
    ...{ flowId: o.threadId ?? undefined, placement: res.placement ?? "main" },
  };
  const data: AgentData = {
    ...{ runId: o.runId, triggerMessageId: o.triggerMessageId, runStatus: v.runStatus },
    ...{ waitKind: v.waitKind, ask: v.ask, stepCount: o.stepCount, runMs: o.runMs },
    ...{ agent: o.agent, caller: o.caller, content },
    ...{ privateContent: o.content || null, privateAsk: o.ask },
  };
  return {
    public: toRoomMessage(rowFor(row, data, "")),
    caller: toRoomMessage(rowFor(row, data, o.callerId)),
    callerId: o.callerId,
  };
}

/** tx2: đọc kết quả → definer → fanout (người nhận dưới khoá `rooms` của definer, cùng tx). */
async function postTx(tx: Tx, runId: string): Promise<Posted | null> {
  const o = await repo.runOutcome(tx, runId);
  if (!o || o.status === "running") return null;
  // Hàng `runs` không khớp phòng/thread/tin (security-1 #1): definer từ chối ⇒ `skipped`, không phát sự kiện.
  if (!o.threadId) {
    const meta = { run_status: "cancelled", step_count: 0, run_ms: 0 } as const;
    const res = await repo.postAgentMessage(tx, { runId, content: EMPTY_CONTENT, meta });
    return { reason: res.reason, events: [] };
  }
  const v = agentMessageView({
    ...{ status: o.status, content: o.content, ask: o.ask },
    ...{ pendingConfirm: o.pendingConfirm, locale: o.locale },
  });
  const content = (v.content || EMPTY_CONTENT).slice(0, CHAT_CONTENT_MAX);
  const res = await repo.postAgentMessage(tx, {
    ...{ runId, content, meta: metaOf(o, v) },
  });
  if (res.reason === "already") return { reason: res.reason, events: [] };
  const fan = await repo.fanoutSys(tx, o.roomId);
  const posted = res.reason === "posted";
  const closed = runClosedEvents(
    {
      ...{ roomId: o.roomId, runId, flowId: o.threadId, callerId: o.callerId },
      ...{ status: v.runStatus, waitKind: posted ? v.waitKind : null },
      messageId: posted ? o.answerMessageId : null,
    },
    fan.map((f) => f.user_id),
  );
  const msg = posted ? agentMessageEvents(o.roomId, messagesOf(o, v, content, res), fan) : [];
  return { reason: res.reason, events: [...msg, ...closed] };
}

export class RoomRunPoster {
  /** Run lỗi ở vòng bù: số lần + mốc thử lại (Map giữ thứ tự chèn ⇒ bỏ cũ nhất khi vượt `BACKOFF_CAP`). */
  readonly #backoff = new Map<string, { n: number; until: number }>();
  constructor(private readonly d: RoomPosterDeps) {}

  /** Hook `onClosed` (B3): đồng bộ, không ném; việc async tự `.catch` (lỗi chỉ log, reconcile bù). */
  readonly onClosed = (runId: string): void => {
    this.post(runId).catch((err) =>
      this.d.log.error("room-post-failed", { run_id: runId, ...safeErrorFields(err) }),
    );
  };

  /** null = không phải run phòng / còn chạy. Phát sự kiện SAU COMMIT. */
  async post(runId: string): Promise<repo.PostResult["reason"] | null> {
    const r = await withHubScope(this.d.db, SYSTEM, (tx) => postTx(tx, runId));
    if (!r) return null;
    if (this.d.redis && r.events.length > 0)
      await publishUserEvents(this.d.redis, r.events, this.d.log);
    return r.reason;
  }

  /**
   * Một lượt bù: ≤ 20 run phòng đã dừng chưa đăng; lỗi một run chỉ log. Trả số run vừa đăng/bỏ qua. Run lỗi lặp
   * (review-1 #5) bị lùi theo cấp số nhân (bộ nhớ, ≤ `BACKOFF_MAX_MS`) và loại khỏi lượt sau ⇒ không chặn vòng bù.
   */
  async reconcile(): Promise<number> {
    const now = Date.now();
    const skip = [...this.#backoff].filter(([, b]) => b.until > now).map(([id]) => id);
    const ids = await withHubScope(this.d.db, SYSTEM, (tx) => repo.unpostedRuns(tx, 20, skip));
    let n = 0;
    for (const id of ids) {
      try {
        const reason = await this.post(id);
        if (reason === null) throw new Error("room run outcome unavailable");
        this.#backoff.delete(id);
        if (reason === "posted" || reason === "skipped") n++;
      } catch (err) {
        const b = this.#fail(id);
        this.d.log.warn("room-post-reconcile-run-failed", {
          ...{ run_id: id, attempts: b.n, ...safeErrorFields(err) },
        });
      }
    }
    return n;
  }

  #fail(id: string): { n: number; until: number } {
    const n = (this.#backoff.get(id)?.n ?? 0) + 1;
    const b = { n, until: Date.now() + Math.min(ROOM_RECONCILE_MS * 2 ** n, BACKOFF_MAX_MS) };
    this.#backoff.delete(id);
    this.#backoff.set(id, b);
    if (this.#backoff.size > BACKOFF_CAP) {
      const oldest = this.#backoff.keys().next().value;
      if (oldest) this.#backoff.delete(oldest);
    }
    return b;
  }

  start(signal?: AbortSignal): void {
    startLoop({
      name: "room-post-reconcile",
      everyMs: ROOM_RECONCILE_MS,
      tick: () => this.reconcile(),
      log: this.d.log,
      signal,
    });
  }
}
