// HUB-FR-113 · U1 · T5 · đưa một tin thread vào outbox trong tx quy trình (scope `user` của người làm, plan-thread §2–§3).
// Đăng thật ở `thread-poster.ts` SAU COMMIT (không khoá `rooms` trong tx quy trình ⇒ không ngược đường với start).
import { type RoomProcessPart, RoomProcessPartSchema } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import * as repo from "./core.repo";
import { type ThreadLocale, threadContent } from "./thread.rules";

export type ThreadEvent = { runId: string; roomId: string } & RoomProcessPart;

/** Tenant chưa có cột locale ⇒ câu tóm tắt theo tiếng Việt; FE dựng hiển thị từ `process` theo locale người xem. */
export const THREAD_LOCALE: ThreadLocale = "vi";

/**
 * Trả id sự kiện (= id tin phòng khi đăng). Run không bắt đầu từ phòng ⇒ no-op, trả "". Phòng lấy từ run (không tin
 * `e.roomId`); meta parse bằng contract (hỏng ⇒ ném — lỗi lập trình, tx ROLLBACK).
 */
export async function enqueueThread(tx: Tx, e: ThreadEvent): Promise<string> {
  const target = await repo.threadTarget(tx, e.runId);
  if (target?.originKind !== "room" || !target.roomId) return "";
  const { runId: _run, roomId: _room, ...part } = e;
  const meta = RoomProcessPartSchema.parse(part);
  const id = crypto.randomUUID();
  await repo.insertThreadEvent(tx, {
    id,
    tenantId: target.tenantId,
    runId: e.runId,
    roomId: target.roomId,
    kind: meta.kind,
    meta,
    content: threadContent(meta, THREAD_LOCALE, { process: target.name }),
  });
  return id;
}
