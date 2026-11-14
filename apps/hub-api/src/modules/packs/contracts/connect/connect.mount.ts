// CR-161 · dựng module kết nối hai công ty: `PackUow` (role `contracts_rw`, chỉ phạm vi người dùng) + repo + use case + route (kết nối, bài, trò chuyện, tệp).
// `redis` vắng ⇒ không phát `cc.link`/`cc.msg` (`/me/stream`); `filebox` vắng ⇒ route tệp 503, tin chữ vẫn chạy và không có việc nền dọn tệp.
// `worker` ⇒ vòng nền dọn tệp chưa gắn tin > 24 h (`hub.cc_files_sweep`, scope system) + xoá nội dung FileBox.
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { logger } from "../../../../lib/logger";
import { startLoop } from "../../../../lib/loop";
import {
  createPackUow,
  type PackAccessView,
  type PackFileboxClient,
  type PackGuardVars,
  packStreamPublishMany,
  packTenantOnly,
  selfContactOf,
} from "../../kit/public";
import { ccFilesSweepClaim, chatRepo } from "./adapters/chat.repo";
import { chatRoutes } from "./adapters/chat.routes";
import { chatFilesRoutes } from "./adapters/chat-files.routes";
import { connectRepo } from "./adapters/connect.repo";
import { connectRoutes } from "./adapters/connect.routes";
import { postsRepo } from "./adapters/posts.repo";
import { postsRoutes } from "./adapters/posts.routes";
import type { ChatFileStore } from "./application/chat.ports";
import { chatFileSweep, chatUsecases } from "./application/chat.usecase";
import { connectUsecases } from "./application/connect.usecase";

const SWEEP_EVERY_MS = 3_600_000;
export type ConnectModuleDeps = {
  redis?: Redis | undefined;
  filebox?: ((org: string) => PackFileboxClient) | null | undefined;
  /** Bật vòng nền dọn tệp (server); test gọi `chatFileSweep` trực tiếp. */
  worker?: boolean | undefined;
  signal?: AbortSignal | undefined;
};

export function connectModule(
  db: Db,
  view: PackAccessView,
  deps: ConnectModuleDeps = {},
): Hono<PackGuardVars> {
  const self = selfContactOf(db);
  const uow = packTenantOnly(
    createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      connect: connectRepo(tx, t),
      posts: postsRepo(tx),
      chat: chatRepo(tx, t),
    })),
  );
  const selfName = async (who: { tenantId: string; userId: string }) => (await self(who)).name;
  const publish = deps.redis ? packStreamPublishMany(deps.redis, logger) : undefined;
  const fb = deps.filebox;
  const files: ChatFileStore | undefined = fb
    ? {
        put: (org, name, bytes) => fb(org).postFile(name, bytes),
        remove: async (org, id) => {
          await fb(org).deleteFile(id);
        },
        link: (org, id) => fb(org).getLink(id),
      }
    : undefined;
  if (files && deps.worker) {
    const sweep = chatFileSweep({ claim: ccFilesSweepClaim(db), store: files });
    startLoop({
      name: "cc-files-sweep",
      everyMs: SWEEP_EVERY_MS,
      tick: sweep,
      log: logger,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  }
  const uc = connectUsecases({ uow, selfName, publish });
  const chat = chatUsecases({ uow, selfName, publish, files });
  const r = new Hono<PackGuardVars>();
  r.route("/", connectRoutes(view, uc));
  r.route("/", postsRoutes(view, uc));
  r.route("/", chatRoutes(view, chat));
  r.route("/", chatFilesRoutes(view, chat));
  return r;
}
