// CR-161 · lát 5 · `/pack/contracts/connect/**` (kết nối hai công ty, không cần hợp đồng). R1: MỌI route `packGuard(view,"contracts","admin")`
// (nhóm «Sổ Hợp Tác – Toàn quyền») TRƯỚC khi đọc tham số/thân — không phải Toàn quyền ⇒ 403 `PACK_FORBIDDEN`, 0 SQL. Lỗi DB ⇒ `ccError`
// (CC422/CC409 ⇒ mã contract, 42501 ⇒ 404, 22023 ⇒ 400). Đồng ý / từ chối nằm ở đây (không dưới `/partner/*`, vốn chặn khi công ty chưa bật
// tính năng Gửi đối tác xác nhận — công ty nhận lời mời có thể chưa bật).
import {
  ConnectDeclineBodySchema,
  ConnectInviteBodySchema,
  ConnectListQuerySchema,
  ConnectSearchQuerySchema,
  ConnectSettingsBodySchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../../lib/errors";
import { parseJson, parseQuery, parseWith } from "../../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import type { ConnectUsecases } from "../application/connect.usecase";
import { decodeCursor } from "../domain/connect.codec";
import { ccError } from "./connect.errors";

const KEY = "contracts";
const UUID = z.uuid();
export const whoOf = (c: { get(k: "user"): { tenantId: string; userId: string } }) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
/** `cursor` sai dạng ⇒ 400. */
export function cursorOf(raw: string | undefined) {
  if (raw === undefined) return null;
  const c = decodeCursor(raw);
  if (!c) throw appError("VALIDATION_ERROR", { issues: [{ path: ["cursor"], code: "invalid" }] });
  return c;
}

export function connectRoutes(view: PackAccessView, uc: ConnectUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const guard = packGuard(view, KEY, "admin");
  // BR-191-11: xem (danh sách, cài đặt, tìm) cho mọi người có quyền xem gói; tìm/mời đối tác MỚI do DB quyết định theo cài đặt công ty.
  const seeGuard = packGuard(view, KEY, "read");

  r.get("/connect/search", seeGuard, async (c) => {
    const q = parseQuery(c, ConnectSearchQuerySchema);
    return c.json({ items: await uc.search(whoOf(c), q.q).catch(ccError) }, 200);
  });

  r.post("/connect/invites", seeGuard, async (c) => {
    const b = await parseJson(c, ConnectInviteBodySchema);
    const status = await uc.invite(whoOf(c), b.tenant_id, b.note || null).catch(ccError);
    return c.json({ status }, 200);
  });

  r.get("/connect/links", seeGuard, async (c) => {
    const q = parseQuery(c, ConnectListQuerySchema);
    const out = await uc
      .links(whoOf(c), { status: q.status, cursor: cursorOf(q.cursor), limit: q.limit })
      .catch(ccError);
    return c.json(out, 200);
  });

  r.post("/connect/links/:tenant_id/accept", guard, async (c) => {
    const from = parseWith(UUID, c.req.param("tenant_id"));
    await uc.accept(whoOf(c), from).catch(ccError);
    return c.json({ ok: true }, 200);
  });

  r.post("/connect/links/:tenant_id/decline", guard, async (c) => {
    const from = parseWith(UUID, c.req.param("tenant_id"));
    const raw: unknown = await c.req.json().catch(() => ({}));
    const b = parseWith(ConnectDeclineBodySchema, raw ?? {});
    await uc.decline(whoOf(c), from, b.reason || null).catch(ccError);
    return c.json({ ok: true }, 200);
  });

  r.delete("/connect/invites/:tenant_id", guard, async (c) => {
    const to = parseWith(UUID, c.req.param("tenant_id"));
    await uc.withdraw(whoOf(c), to).catch(ccError);
    return c.json({ ok: true }, 200);
  });

  r.get("/connect/settings", seeGuard, async (c) => c.json(await uc.settings(whoOf(c)), 200));

  r.put("/connect/settings", guard, async (c) => {
    const b = await parseJson(c, ConnectSettingsBodySchema);
    await uc.setInviteBy(whoOf(c), b.invite_by);
    return c.json({ ok: true }, 200);
  });

  r.get("/connect/companies/:tenant_id", seeGuard, async (c) => {
    const id = parseWith(UUID, c.req.param("tenant_id"));
    const page = await uc.company(whoOf(c), id).catch(ccError);
    if (!page) throw appError("NOT_FOUND");
    return c.json(page, 200);
  });

  r.delete("/connect/links/:tenant_id", guard, async (c) => {
    const other = parseWith(UUID, c.req.param("tenant_id"));
    await uc.disconnect(whoOf(c), other).catch(ccError);
    return c.json({ ok: true }, 200);
  });
  return r;
}
