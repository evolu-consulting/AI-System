// HD-FR-53…55 · HD5 plan: route loại hàng, gắn HĐ gốc (+ gợi ý) và bảng giá. Guard TRƯỚC đọc thân (viewer ghi ⇒ 403, 0 SQL); `:id`
// sai dạng ⇒ 400; id lạ/tenant khác ⇒ 404 giống hệt. Tenant/user chỉ từ token.
import {
  AttachParentRequestSchema,
  CONTRACT_ERRORS,
  CreateCategoryRequestSchema,
  IsoDateSchema,
} from "@ai/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { AttachParent, GetPrices, SuggestParents } from "../application/appendix.usecase";
import type { CreateCategory, ListCategories } from "../application/categories.usecase";
import { lockedError } from "./manage.routes";

export type AppendixUseCases = {
  listCategories: ListCategories;
  createCategory: CreateCategory;
  attachParent: AttachParent;
  suggestParents: SuggestParents;
  prices: GetPrices;
  /** Ngày lịch hôm nay theo múi giờ của tenant (HD4-FR-02); mặc định theo múi của tenant token. */
  today: (tenantId: string) => Promise<string>;
};

const whoOf = (u: { tenantId: string; userId: string }) => ({
  tenantId: u.tenantId,
  userId: u.userId,
});
const idOf = (c: Context): string => parseWith(z.uuid(), c.req.param("id"));
const BODY_MAX = 4 * 1024;

type Guard = ReturnType<typeof packGuard>;
type Guards = { read: Guard; write: Guard };

export function appendixRoutes(
  view: PackAccessView,
  key: string,
  uc: AppendixUseCases,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const g = { read: packGuard(view, key, "read"), write: packGuard(view, key, "write") };
  categoryRoutes(r, g, uc);
  parentRoutes(r, g, uc);
  return r;
}

function categoryRoutes(r: Hono<PackGuardVars>, { read, write }: Guards, uc: AppendixUseCases) {
  r.get("/categories", read, async (c) =>
    c.json({ items: await uc.listCategories(whoOf(c.get("user"))) }),
  );
  r.post("/categories", write, async (c) => {
    const body = parseWith(CreateCategoryRequestSchema, await readJson(c));
    const res = await uc.createCategory(whoOf(c.get("user")), body.name);
    if (res.kind === "exists")
      throw new AppError("CATEGORY_EXISTS", CONTRACT_ERRORS.CATEGORY_EXISTS, "Category exists");
    if (res.kind === "full")
      throw new AppError("CATEGORY_LIMIT", CONTRACT_ERRORS.CATEGORY_LIMIT, "Too many categories");
    return c.json(res.row, 201);
  });
}

function parentRoutes(r: Hono<PackGuardVars>, { read, write }: Guards, uc: AppendixUseCases) {
  r.patch("/contracts/:id/parent", write, async (c) => {
    const id = idOf(c);
    if (Number(c.req.header("content-length") ?? 0) > BODY_MAX)
      throw new AppError("PAYLOAD_TOO_LARGE", 413, "Payload too large");
    const body = parseWith(AttachParentRequestSchema, await readJson(c));
    return c.json(attachedOut(await uc.attachParent(whoOf(c.get("user")), id, body)));
  });
  r.get("/contracts/:id/parent-suggestions", read, async (c) => {
    const items = await uc.suggestParents(whoOf(c.get("user")), idOf(c));
    if (!items) throw appError("NOT_FOUND");
    return c.json({ items });
  });
  r.get("/contracts/:id/prices", read, async (c) => {
    const id = idOf(c);
    const asOf = c.req.query("as_of");
    const who = whoOf(c.get("user"));
    const date = asOf === undefined ? await uc.today(who.tenantId) : parseWith(IsoDateSchema, asOf);
    const out = await uc.prices(who, id, date);
    if (!out) throw appError("NOT_FOUND");
    return c.json(out);
  });
}

/** Kết quả gắn HĐ gốc ⇒ DTO; lỗi nghiệp vụ ⇒ AppError (404/409/422). */
function attachedOut(res: Awaited<ReturnType<AttachParent>>) {
  if (res.kind === "not_found") throw appError("NOT_FOUND");
  if (res.kind === "locked") throw lockedError();
  if (res.kind === "stale")
    throw new AppError("CONTRACT_STALE", CONTRACT_ERRORS.CONTRACT_STALE, "Contract was modified", {
      current: res.current,
      updated_at: res.updated_at,
    });
  if (res.kind === "invalid_parent")
    throw new AppError(
      "PARENT_INVALID",
      CONTRACT_ERRORS.PARENT_INVALID,
      "Invalid parent contract",
      {
        reason: res.reason,
      },
    );
  const o = res.out;
  return {
    id: o.id,
    kind: o.kind,
    parent_id: o.parentId,
    version: o.version,
    updated_at: o.updatedAt,
  };
}
