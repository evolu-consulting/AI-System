// CR-132 M3 · HD-MSG-01..12 · nối API tin nhắn Sổ Hợp Tác: `PackUow` (role `contracts_rw`) + tra người dùng (kit, admin.users) → use case → route. Gắn dưới
// `/pack/contracts` ở `packs.mount.ts`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../../lib/logger";
import { startLoop } from "../../../../lib/loop";
import type { Redis } from "../../../../lib/redis";
import {
  createPackUow,
  internalDirectoryPage,
  internalUsersAmong,
  type PackAccessView,
  type PackFileboxClient,
  type PackGuardVars,
  packStreamPublishMany,
  packTenantOnly,
} from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import { messagesRoutes } from "./adapters/messages.routes";
import { partnerFilesSweepClaim, partnerRepo } from "./adapters/partner.repo";
import type { MsgFileStore } from "./application/messages.ports";
import { messagesUsecases } from "./application/messages.usecase";
import { partnerFileSweep } from "./application/partner-chat.usecase";

const SWEEP_EVERY_MS = 3_600_000;

/** `redis` vắng ⇒ không phát `msg.*` (`/me/stream`, sau commit); `filebox` vắng ⇒ route tệp 503, tin chữ vẫn chạy và không có việc nền. `worker` ⇒ vòng nền (1 giờ) dọn tệp `partner` chưa gắn tin > 24 h (`hub.pmsg_files_sweep`, scope system) + xoá byte FileBox. */
export function messagesModule(
  db: Db,
  view: PackAccessView,
  deps: {
    redis?: Redis | undefined;
    filebox?: ((org: string) => PackFileboxClient) | null | undefined;
    worker?: boolean | undefined;
    /** Thay `fetch` khi đọc byte từ link FileBox (test). */
    fetchFile?: ((url: string) => Promise<Response>) | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Hono<PackGuardVars> {
  const { redis, filebox } = deps;
  const files: MsgFileStore | undefined = filebox
    ? {
        put: (org, name, bytes) => filebox(org).postFile(name, bytes),
        remove: async (org, fileId) => {
          await filebox(org).deleteFile(fileId);
        },
        link: (org, fileId) => filebox(org).getLink(fileId),
        bytes: async (org, fileId) => {
          const url = await filebox(org).getLink(fileId);
          if (!url || !/^https?:\/\//.test(url)) return null; // link tương đối (qua proxy công khai) ⇒ trình duyệt tự tải cùng origin
          const res = await (deps.fetchFile ?? fetch)(url).catch(() => null);
          return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        },
      }
    : undefined;
  if (files && deps.worker)
    startLoop({
      name: "pmsg-files-sweep",
      everyMs: SWEEP_EVERY_MS,
      tick: partnerFileSweep({ claim: partnerFilesSweepClaim(db), store: files }),
      log: logger,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  const uc = messagesUsecases({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({
        messages: messagesRepo(tx, t),
        partner: partnerRepo(tx, t),
      })),
    ),
    people: internalUsersAmong(db),
    directory: internalDirectoryPage(db),
    newId: () => Bun.randomUUIDv7(),
    publish: redis ? packStreamPublishMany(redis, logger) : undefined,
    files,
  });
  return messagesRoutes(view, uc);
}
