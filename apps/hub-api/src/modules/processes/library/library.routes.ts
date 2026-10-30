// CR-105 · L2a · route thư viện quy trình (readiness Chặn 2: mở rộng `/process-defs…`, không tiền tố `/process-library`) +
// `/process-slots` + `/tenants/:tid/process-slots…`. MỌI route ở đây chỉ platform_admin: 403 trước parse/đọc DB. Không logic.
import {
  AssignSlotRequestSchema,
  CopyProcessDefRequestSchema,
  PublishProcessDefRequestSchema,
  RollbackProcessDefRequestSchema,
  SetSlotDefaultRequestSchema,
  SlotKeySchema,
} from "@ai/contracts/hub-admin";
import { type Context, Hono } from "hono";
import { requirePlatformAdmin } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam, parseJson, validationError } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { LibraryService } from "./library.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type C = Context<AuthVars>;

const param = (c: C, name: string, ok: (v: string) => boolean): string => {
  const v = c.req.param(name) ?? "";
  if (!ok(v)) throw validationError([{ path: [name], code: "custom", message: `Invalid ${name}` }]);
  return v;
};
const slotOf = (c: C) => param(c, "slot", (v) => SlotKeySchema.safeParse(v).success);
const tidOf = (c: C) => param(c, "tid", (v) => UUID.test(v));
const relOf = (c: C) => Number(param(c, "v", (v) => /^[1-9]\d{0,8}$/.test(v)));

/** Đường dẫn thư viện cần cổng platform_admin (gắn trước route, cả khi id lạ ⇒ 403 không lộ tồn tại). */
const GATED = [
  "/process-slots",
  "/process-slots/*",
  "/tenants/:tid/process-slots",
  "/tenants/:tid/process-slots/*",
  "/process-defs/:id/impact",
  "/process-defs/:id/publish",
  "/process-defs/:id/releases",
  "/process-defs/:id/releases/*",
  "/process-defs/:id/rollback",
  "/process-defs/:id/clone",
  "/process-defs/:id/assignments",
];

export function libraryRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new LibraryService(d);
  const r = new Hono<AuthVars>();
  for (const p of GATED) r.use(p, requirePlatformAdmin());
  r.get("/process-slots", async (c) => c.json(await svc.slots()));
  r.put("/process-slots/:slot/default", async (c) => {
    const slot = slotOf(c);
    const b = await parseJson(c, SetSlotDefaultRequestSchema);
    return c.json(await svc.setDefault(c.var.user, slot, b.def_id));
  });
  r.get("/process-defs/:id/impact", async (c) => c.json(await svc.impact(parseIdParam(c))));
  r.post("/process-defs/:id/publish", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, PublishProcessDefRequestSchema);
    return c.json(await svc.publish(c.var.user, id, b), 201);
  });
  r.get("/process-defs/:id/releases", async (c) => c.json(await svc.releases(parseIdParam(c))));
  r.get("/process-defs/:id/releases/:v", async (c) =>
    c.json(await svc.release(parseIdParam(c), relOf(c))),
  );
  r.post("/process-defs/:id/rollback", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, RollbackProcessDefRequestSchema);
    return c.json(await svc.rollback(c.var.user, id, b), 201);
  });
  r.post("/process-defs/:id/clone", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, CopyProcessDefRequestSchema);
    return c.json(await svc.clone(c.var.user, id, b), 201);
  });
  r.get("/process-defs/:id/assignments", async (c) =>
    c.json(await svc.assignments(parseIdParam(c))),
  );
  tenantRoutes(r, svc);
  return r;
}

function tenantRoutes(r: Hono<AuthVars>, svc: LibraryService): void {
  r.get("/tenants/:tid/process-slots", async (c) => c.json(await svc.tenantSlots(tidOf(c))));
  r.put("/tenants/:tid/process-slots/:slot", async (c) => {
    const tid = tidOf(c);
    const slot = slotOf(c);
    const b = await parseJson(c, AssignSlotRequestSchema);
    return c.json(await svc.assign(c.var.user, tid, slot, b.def_id));
  });
  r.delete("/tenants/:tid/process-slots/:slot", async (c) => {
    await svc.unassign(c.var.user, tidOf(c), slotOf(c));
    return c.body(null, 204);
  });
}
