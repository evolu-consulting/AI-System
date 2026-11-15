// CR-161 · dựng module kết nối hai công ty: `PackUow` (role `contracts_rw`, chỉ phạm vi người dùng) + repo + use case + route (kết nối, bài công khai).
// `redis` vắng ⇒ không phát `cc.link` (`/me/stream`). CR-169: trò chuyện + tệp + vòng nền dọn tệp đã chuyển sang module `messages` (hub `pmsg_*`);
// `filebox`/`worker`/`signal` còn trong kiểu vì `connectDeps` dùng chung cho các module gói khác.
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { logger } from "../../../../lib/logger";
import {
  createPackUow,
  type PackAccessView,
  type PackFileboxClient,
  type PackGuardVars,
  packStreamPublishMany,
  packTenantOnly,
  selfContactOf,
} from "../../kit/public";
import { connectRepo } from "./adapters/connect.repo";
import { connectRoutes } from "./adapters/connect.routes";
import { postsRepo } from "./adapters/posts.repo";
import { postsRoutes } from "./adapters/posts.routes";
import { connectUsecases } from "./application/connect.usecase";

export type ConnectModuleDeps = {
  redis?: Redis | undefined;
  filebox?: ((org: string) => PackFileboxClient) | null | undefined;
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
    })),
  );
  const selfName = async (who: { tenantId: string; userId: string }) => (await self(who)).name;
  const publish = deps.redis ? packStreamPublishMany(deps.redis, logger) : undefined;
  const uc = connectUsecases({ uow, selfName, publish });
  const r = new Hono<PackGuardVars>();
  r.route("/", connectRoutes(view, uc));
  r.route("/", postsRoutes(view, uc));
  return r;
}
