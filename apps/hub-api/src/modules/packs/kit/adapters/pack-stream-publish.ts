// CR-125 · x6 · cổng kit: gói đẩy sự kiện tới `/me/stream` của người dùng qua kit (gói không import `lib/user-stream` của hub — pack-boundary).
// Chỉ các sự kiện gói được phép phát (kiểu hẹp); lỗi Redis chỉ log (không ném) như mọi sự kiện luồng người dùng.
// CR-132 M4: `packStreamPublishMany` — nhiều khung (mỗi khung = một sự kiện + danh sách người nhận) trong MỘT pipeline Redis, phát SAU commit.
import type { EsignUpdatedEventData, MeStreamMsgEvent } from "@ai/contracts/chat";
import type { Logger } from "../../../../lib/logger";
import type { Redis } from "../../../../lib/redis";
import { publishUserEvents } from "../../../../lib/user-stream";

/** Sự kiện gói được phát lên `/me/stream`. */
export type PackStreamEvent =
  | { event: "esign.updated"; data: EsignUpdatedEventData }
  | MeStreamMsgEvent;
export type PackStreamPublish = (userIds: string[], e: PackStreamEvent) => Promise<void>;
/** Một khung = một sự kiện + người nhận (đã khử trùng). */
export type PackStreamFrame = { userIds: string[] } & PackStreamEvent;
export type PackStreamPublishMany = (frames: readonly PackStreamFrame[]) => Promise<void>;

export const packStreamPublish =
  (redis: Pick<Redis, "pipeline">, log: Pick<Logger, "warn">): PackStreamPublish =>
  (userIds, e) =>
    publishUserEvents(redis, [{ userIds, ...e }], log);

/** MỘT `pipeline()` cho cả lô khung (không vòng gọi mạng theo người nhận); không khung/không người nhận ⇒ không gọi Redis. */
export const packStreamPublishMany =
  (redis: Pick<Redis, "pipeline">, log: Pick<Logger, "warn">): PackStreamPublishMany =>
  (frames) =>
    publishUserEvents(redis, [...frames], log);
