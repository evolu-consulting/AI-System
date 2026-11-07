// CR-125 · x6 · cổng kit: gói đẩy sự kiện tới `/me/stream` của người dùng qua kit (gói không import `lib/user-stream` của hub — pack-boundary).
// Chỉ các sự kiện gói được phép phát (kiểu hẹp); lỗi Redis chỉ log (không ném) như mọi sự kiện luồng người dùng.
import type { EsignUpdatedEventData } from "@ai/contracts/chat";
import type { Logger } from "../../../../lib/logger";
import type { Redis } from "../../../../lib/redis";
import { publishUserEvents } from "../../../../lib/user-stream";

/** Sự kiện gói được phát lên `/me/stream`. */
export type PackStreamEvent = { event: "esign.updated"; data: EsignUpdatedEventData };
export type PackStreamPublish = (userIds: string[], e: PackStreamEvent) => Promise<void>;

export const packStreamPublish =
  (redis: Pick<Redis, "pipeline">, log: Pick<Logger, "warn">): PackStreamPublish =>
  (userIds, e) =>
    publishUserEvents(redis, [{ userIds, ...e }], log);
