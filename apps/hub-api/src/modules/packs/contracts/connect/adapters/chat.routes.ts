// CR-161 · lát 6 · `/pack/contracts/connect/threads/:tenant_id/{messages,read}` (R8): xem trang tin (cursor `before=seq`), gửi (idempotent theo `client_id`),
// đánh dấu đã đọc. R1: `packGuard(view,"contracts","admin")` TRƯỚC khi đọc tham số/thân (nhân viên ⇒ 403, 0 SQL). Luồng luôn suy từ (công ty người gọi,
// `:tenant_id`) — công ty thứ ba không chạm được luồng của hai công ty khác (chưa kết nối: đọc ⇒ 404 `CONNECT_NO_THREAD`, gửi ⇒ 409 `CONNECT_READ_ONLY`).
import {
  CcMessagesQuerySchema,
  CcReadBodySchema,
  CcSendBodySchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { parseJson, parseQuery, parseWith } from "../../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import type { ChatUsecases } from "../application/chat.usecase";
import { ccError } from "./connect.errors";
import { whoOf } from "./connect.routes";

const UUID = z.uuid();

export function chatRoutes(view: PackAccessView, uc: ChatUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const guard = packGuard(view, "contracts", "admin");

  r.get("/connect/threads/:tenant_id/messages", guard, async (c) => {
    const other = parseWith(UUID, c.req.param("tenant_id"));
    const q = parseQuery(c, CcMessagesQuerySchema);
    const out = await uc
      .page(whoOf(c), other, { before: q.before ?? null, limit: q.limit })
      .catch(ccError);
    c.header("cache-control", "no-store");
    return c.json(out, 200);
  });

  r.post("/connect/threads/:tenant_id/messages", guard, async (c) => {
    const other = parseWith(UUID, c.req.param("tenant_id"));
    const b = await parseJson(c, CcSendBodySchema);
    const out = await uc.send(whoOf(c), other, b).catch(ccError);
    return c.json(out, 200);
  });

  r.post("/connect/threads/:tenant_id/read", guard, async (c) => {
    const other = parseWith(UUID, c.req.param("tenant_id"));
    const b = await parseJson(c, CcReadBodySchema);
    const last = await uc.markRead(whoOf(c), other, b.seq).catch(ccError);
    return c.json({ last_read_seq: last }, 200);
  });
  return r;
}
