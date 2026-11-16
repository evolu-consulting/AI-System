// CR-132 M3 · HD-MSG-01..12 · nối API tin nhắn Sổ Hợp Tác: `PackUow` (role `contracts_rw`) + tra người dùng (kit, admin.users) → use case → route. Gắn dưới
// `/pack/contracts` ở `packs.mount.ts`.
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import { MSG_ERRORS } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { AppError } from "../../../../lib/errors";
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
        // CR-178 · xem trước: máy chủ ↔ máy chủ qua client FileBox (có token, timeout, retry); tối đa ATTACH_MAX_BYTES. FileBox lỗi ⇒ 503 (không lộ URL nội bộ); quá lớn ⇒ 413.
        bytes: async (org, fileId) => {
          try {
            return await filebox(org).getContent(fileId, ATTACH_MAX_BYTES);
          } catch (e) {
            if (e instanceof Error && e.name === "StorageTooLarge")
              throw new AppError(
                "MSG_FILE_TOO_LARGE",
                MSG_ERRORS.MSG_FILE_TOO_LARGE,
                "MSG_FILE_TOO_LARGE",
              );
            throw new AppError("FILE_STORAGE_UNAVAILABLE", 503, "FILE_STORAGE_UNAVAILABLE");
          }
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
