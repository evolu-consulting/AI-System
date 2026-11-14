// CR-161 · lát 5 · dựng module kết nối hai công ty: `PackUow` (role `contracts_rw`, chỉ phạm vi người dùng) + repo + use case + route.
// `redis` vắng ⇒ không phát `cc.link` (`/me/stream`). Lát trò chuyện (6) thêm route vào cùng module.
import type { Db, Tx } from "@ai/db";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { logger } from "../../../../lib/logger";
import {
  createPackUow,
  type PackAccessView,
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

export function connectModule(
  db: Db,
  view: PackAccessView,
  deps: { redis?: Redis | undefined } = {},
): Hono<PackGuardVars> {
  const self = selfContactOf(db);
  const uc = connectUsecases({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx: Tx, t: string) => ({
        connect: connectRepo(tx, t),
        posts: postsRepo(tx),
      })),
    ),
    selfName: async (who) => (await self(who)).name,
    publish: deps.redis ? packStreamPublishMany(deps.redis, logger) : undefined,
  });
  const r = new Hono<PackGuardVars>();
  r.route("/", connectRoutes(view, uc));
  r.route("/", postsRoutes(view, uc));
  return r;
}
