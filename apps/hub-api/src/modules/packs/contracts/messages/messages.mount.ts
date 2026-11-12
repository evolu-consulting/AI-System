// CR-132 M3 · HD-MSG-01..12 · nối API tin nhắn Sổ Hợp Tác: `PackUow` (role `contracts_rw`) + tra người dùng (kit, admin.users) → use case → route. Gắn dưới
// `/pack/contracts` ở `packs.mount.ts`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../../lib/logger";
import type { Redis } from "../../../../lib/redis";
import {
  createPackUow,
  internalUsersAmong,
  type PackAccessView,
  type PackFileboxClient,
  type PackGuardVars,
  packStreamPublishMany,
  packTenantOnly,
} from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import { messagesRoutes } from "./adapters/messages.routes";
import { messagesUsecases } from "./application/messages.usecase";

/** `redis` vắng ⇒ không phát `msg.*` (`/me/stream`, sau commit); `filebox` vắng ⇒ route tệp 503, tin chữ vẫn chạy. */
export function messagesModule(
  db: Db,
  view: PackAccessView,
  deps: {
    redis?: Redis | undefined;
    filebox?: ((org: string) => PackFileboxClient) | null | undefined;
  } = {},
): Hono<PackGuardVars> {
  const { redis, filebox } = deps;
  const uc = messagesUsecases({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({ messages: messagesRepo(tx, t) })),
    ),
    people: internalUsersAmong(db),
    newId: () => Bun.randomUUIDv7(),
    publish: redis ? packStreamPublishMany(redis, logger) : undefined,
    files: filebox
      ? {
          put: (org, name, bytes) => filebox(org).postFile(name, bytes),
          remove: async (org, fileId) => {
            await filebox(org).deleteFile(fileId);
          },
          link: (org, fileId) => filebox(org).getLink(fileId),
        }
      : undefined,
  });
  return messagesRoutes(view, uc);
}
