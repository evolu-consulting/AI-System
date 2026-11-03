// HUB-FR-143 · CA-R07 · plan-addendum A7 Q4: phát sự kiện outbox của `UnitOfWork` SAU COMMIT — `user_events` một pipeline
// Redis cho cả mảng; `kick`/`post_thread` qua launcher/ThreadPoster sẵn có. Lỗi một sự kiện chỉ log (đã COMMIT, không
// rollback, không chặn sự kiện khác).
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import type { OutboxEvent } from "../application/ports";
import type { ProcessDeps } from "../core/ports";

type PublishDeps = Pick<ProcessDeps, "launcher" | "postThread"> & {
  redis: Pick<Redis, "pipeline">;
  log: Pick<Logger, "warn">;
};

/** CR-115 · `kickMany` ⇒ phát của lô `systemEach` (CHỈ vòng hẹn giờ `retry`); vắng ⇒ đường cũ, giữ thứ tự sự kiện. */
export type PublishOpts = { kickMany?: boolean };

/**
 * CR-115 · lô hẹn giờ (`opts.kickMany`) có ≥ 2 kick ⇒ `kickMany` (một tx cho cả lô, lỗi từng run tự rơi về `kick`).
 * `true` ⇒ đã kick theo lô (người gọi bỏ sự kiện `kick` lẻ). Mọi phát khác (chat, PF2, huỷ/apply…) giữ đường cũ.
 */
async function kickBatch(
  d: PublishDeps,
  events: readonly OutboxEvent[],
  opts: PublishOpts | undefined,
): Promise<boolean> {
  const kicks = events.flatMap((e) => (e.kind === "kick" ? [e.runId] : []));
  const kickMany = d.launcher.kickMany;
  if (opts?.kickMany !== true || !kickMany || kicks.length < 2) return false;
  await kickMany
    .call(d.launcher, kicks)
    .catch((err) =>
      d.log.warn("process-outbox-publish-failed", { kind: "kick_many", ...safeErrorFields(err) }),
    );
  return true;
}

export function makeOutboxPublisher(
  d: PublishDeps,
): (events: readonly OutboxEvent[], opts?: PublishOpts) => Promise<void> {
  return async (events, opts) => {
    // `user_events` do adapter/code cũ dựng đúng kiểu `UserEvent` (lớp 2 chỉ chuyển tiếp).
    const user = events.flatMap((e) => (e.kind === "user_events" ? (e.events as UserEvent[]) : []));
    if (user.length > 0) await publishUserEvents(d.redis, user, d.log);
    const many = await kickBatch(d, events, opts);
    for (const e of events) {
      if (e.kind === "user_events" || (many && e.kind === "kick")) continue;
      try {
        if (e.kind === "kick") await d.launcher.kick(e.runId);
        else await d.postThread(e.runId);
      } catch (err) {
        d.log.warn("process-outbox-publish-failed", {
          kind: e.kind,
          run_id: e.runId,
          ...safeErrorFields(err),
        });
      }
    }
  };
}
