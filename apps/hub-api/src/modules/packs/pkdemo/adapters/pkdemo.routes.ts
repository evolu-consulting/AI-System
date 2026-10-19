// PK-FR-09 · PK-AC10 · N1 plan §10: route gói kiểm thử `pkdemo` (mount dưới `/pack/pkdemo`, sau `requireAuth`). Quyền: GET
// `read`, POST `write` (guard T5b, 403 trước 400). Body không bao giờ mang phạm vi: zod strip `tenant_id`/`user_id`; tenant/user
// chỉ từ token. Sai body ⇒ 400 `VALIDATION_ERROR`; `:id` không phải uuid / không thấy ⇒ 404 `NOT_FOUND` (không lộ tồn tại).
import { Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseIdParam, parseJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { CreateItem } from "../application/create-item.usecase";
import type { GetItem } from "../application/get-item.usecase";
import { ITEM_LINE_TEXT_MAX, ITEM_LINES_MAX, ITEM_TITLE_MAX } from "../domain/item";

export const PKDEMO_KEY = "pkdemo";

/** Body `POST /pack/pkdemo/items` (không vào `@ai/contracts` — gói kiểm thử). Khoá lạ bị bỏ (strip). */
export const CreateItemBodySchema = z.object({
  title: z.string().min(1).max(ITEM_TITLE_MAX),
  lines: z.array(z.object({ text: z.string().min(1).max(ITEM_LINE_TEXT_MAX) })).max(ITEM_LINES_MAX),
});

export type PkdemoUseCases = { create: CreateItem; get: GetItem };

const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});

export function pkdemoRoutes(view: PackAccessView, uc: PkdemoUseCases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/items/:id", packGuard(view, PKDEMO_KEY, "read"), async (c) => {
    const id = parseIdParam(c);
    const item = await uc.get(whoOf(c.get("user")), id);
    if (!item) throw appError("NOT_FOUND");
    return c.json(item);
  });
  r.post("/items", packGuard(view, PKDEMO_KEY, "write"), async (c) => {
    const body = await parseJson(c, CreateItemBodySchema);
    return c.json(await uc.create(whoOf(c.get("user")), body), 201);
  });
  return r;
}
