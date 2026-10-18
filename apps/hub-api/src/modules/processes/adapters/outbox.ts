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

export function makeOutboxPublisher(
  d: PublishDeps,
): (events: readonly OutboxEvent[]) => Promise<void> {
  return async (events) => {
    // `user_events` do adapter/code cũ dựng đúng kiểu `UserEvent` (lớp 2 chỉ chuyển tiếp).
    const user = events.flatMap((e) => (e.kind === "user_events" ? (e.events as UserEvent[]) : []));
    if (user.length > 0) await publishUserEvents(d.redis, user, d.log);
    for (const e of events) {
      if (e.kind === "user_events") continue;
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
