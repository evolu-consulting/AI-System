// CR-161 · lát 5 · `GET /pack/contracts/connect/posts/:tenant_id` (R10): bài công khai (bản đã che) của công ty ĐÃ KẾT NỐI. `packGuard` Toàn quyền
// trước tiên (R1). Chưa/không còn kết nối, công ty thứ ba ⇒ 404 `CONNECT_NOT_CONNECTED` (DB 42501); bên đăng không bật Bảng tin ⇒ danh sách rỗng.
import { CcPostsQuerySchema } from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { parseQuery, parseWith } from "../../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import type { ConnectUsecases } from "../application/connect.usecase";
import { ccError } from "./connect.errors";
import { cursorOf, whoOf } from "./connect.routes";

export function postsRoutes(view: PackAccessView, uc: ConnectUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/connect/posts/:tenant_id", packGuard(view, "contracts", "admin"), async (c) => {
    const owner = parseWith(z.uuid(), c.req.param("tenant_id"));
    const q = parseQuery(c, CcPostsQuerySchema);
    const out = await uc
      .posts(whoOf(c), owner, { cursor: cursorOf(q.cursor), limit: q.limit })
      .catch((e) => ccError(e, "CONNECT_NOT_CONNECTED"));
    return c.json(out, 200);
  });
  return r;
}
