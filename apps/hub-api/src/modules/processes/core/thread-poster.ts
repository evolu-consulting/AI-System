// HUB-FR-113 · U1 · T5 · T9 · T10 · đăng outbox `process_thread_events` thành tin phòng `sender_type='process'` (plan-thread
// §1, §3). Mỗi sự kiện một tx `system`: khoá run `FOR SHARE` (RA-01, plan §6: run → room) → definer khoá `rooms` → sự
// kiện → chèn tin (`id = event.id`, idempotent; FK `process_run_id` đã có khoá run) → `room_fanout_sys` cùng tx ⇒ phát
// `room.message` + `room.unread` SAU COMMIT. Cùng thứ tự với tx quy trình/cổng (run → … → rooms qua FK sự kiện); tx start
// (rooms → chèn run mới) không đụng run đã commit. Phòng xoá ⇒ `skipped`, run chạy tiếp (T10).
import type { RoomProcessPart } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { Redis } from "../../../lib/redis";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import { messageEvents } from "../../rooms/room-events";
import { toRoomMessage } from "../../rooms/rooms.map";
import * as repo from "./core.repo";

export const THREAD_RECONCILE_MS = 5_000;
/** Mỗi lượt bù ≤ 100 sự kiện (plan §11: vòng quét có `LIMIT`). */
const BATCH = 100;
const SYSTEM = { kind: "system" } as const;

export type ThreadPosterDeps = { db: Db; redis?: Pick<Redis, "pipeline">; log: Logger };
type Posted = { posted: boolean; events: UserEvent[] };

/** Tin vừa đăng ⇒ sự kiện `/me/stream` cho thành viên hiện tại (người ngoài phòng không nhận — T8). */
async function eventsOf(tx: Tx, eventId: string, p: repo.PostedEvent): Promise<UserEvent[]> {
  const m = await repo.eventMessage(tx, eventId);
  if (!m || p.seq === null || p.createdAt === null) return [];
  const msg = toRoomMessage({
    ...{ id: m.id, roomId: m.roomId, seq: p.seq, senderType: "process" },
    sender: { id: m.senderId, displayName: m.name, username: null },
    ...{ content: m.content, clientMsgId: null, createdAt: p.createdAt },
    ...{ flowId: m.flowId, placement: m.placement, processRunId: m.runId },
    processMeta: m.meta as RoomProcessPart,
  });
  return messageEvents(m.roomId, msg, await repo.fanoutSys(tx, m.roomId));
}

async function postTx(tx: Tx, eventId: string): Promise<Posted> {
  // RA-01 · plan §6 · run trước rooms (FK `room_messages.process_run_id` khoá run sau rooms ⇒ chu trình với tx quy trình).
  await repo.lockEventRun(tx, eventId);
  const p = await repo.postProcessMessage(tx, eventId);
  if (!p.posted) return { posted: false, events: [] };
  return { posted: true, events: await eventsOf(tx, eventId, p) };
}

export class ThreadPoster {
  constructor(private readonly d: ThreadPosterDeps) {}

  async #postEvent(eventId: string): Promise<boolean> {
    const r = await withHubScope(this.d.db, SYSTEM, (tx) => postTx(tx, eventId));
    if (this.d.redis && r.events.length > 0)
      await publishUserEvents(this.d.redis, r.events, this.d.log);
    return r.posted;
  }

  /** Đăng lần lượt (thứ tự `created_at, id`); lỗi một sự kiện chỉ log, sự kiện sau của CÙNG run chờ lượt sau (giữ thứ tự). */
  async #drain(runId?: string): Promise<number> {
    const rows = await withHubScope(this.d.db, SYSTEM, (tx) =>
      repo.unpostedEvents(tx, BATCH, runId),
    );
    const blocked = new Set<string>();
    let n = 0;
    for (const e of rows) {
      if (blocked.has(e.runId)) continue;
      try {
        if (await this.#postEvent(e.id)) n++;
      } catch (err) {
        blocked.add(e.runId);
        this.d.log.warn("process-thread-post-failed", { event_id: e.id, ...safeErrorFields(err) });
      }
    }
    return n;
  }

  /** Sau COMMIT tx quy trình (PF1/PF2): đăng mọi sự kiện chưa đăng của run. Không ném (vòng bù 5 s đăng lại). */
  async post(runId: string): Promise<number> {
    try {
      return await this.#drain(runId);
    } catch (err) {
      this.d.log.warn("process-thread-post-failed", {
        process_run_id: runId,
        ...safeErrorFields(err),
      });
      return 0;
    }
  }

  /** Một lượt bù (seam `ProcessHandles.postThreadOnce`): trả số tin vừa đăng (không tính `already`/`skipped`). */
  postThreadOnce(): Promise<number> {
    return this.#drain();
  }

  start(signal?: AbortSignal): void {
    startLoop({
      name: "process-thread-reconcile",
      everyMs: THREAD_RECONCILE_MS,
      tick: () => this.postThreadOnce(),
      log: this.d.log,
      signal,
    });
  }
}
