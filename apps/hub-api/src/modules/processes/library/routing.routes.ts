// CR-118 §11.2 · route luật chọn quy trình + tập quy trình đã gán. Không logic. Cổng vai TRƯỚC parse/đọc DB:
// - `/tenants/:tid/process-routing/:slot` GET/PUT: admin (member ⇒ 403); tenant_admin khác tenant ⇒ 404 (service chốt).
// - `/tenants/:tid/process-routing/:slot/processes/:defId` PUT/DELETE: chỉ platform_admin; GET (xem sơ đồ): như GET luật.
import { PutProcessRoutingRequestSchema, SlotKeySchema } from "@ai/contracts/hub-admin";
import type { Context, Hono } from "hono";
import { requireAdminRole, requirePlatformAdmin } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson, validationError } from "../../../lib/http";
import { tenantAdminReadOnly } from "./platform-write.middleware";
import type { RoutingService } from "./routing.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type C = Context<AuthVars>;
const param = (c: C, name: string, ok: (v: string) => boolean): string => {
  const v = c.req.param(name) ?? "";
  if (!ok(v)) throw validationError([{ path: [name], code: "custom", message: `Invalid ${name}` }]);
  return v;
};
const tidOf = (c: C) => param(c, "tid", (v) => UUID.test(v)).toLowerCase();
const slotOf = (c: C) => param(c, "slot", (v) => SlotKeySchema.safeParse(v).success);
const defOf = (c: C) => param(c, "defId", (v) => UUID.test(v)).toLowerCase();

const BASE = "/tenants/:tid/process-routing/:slot";

export function routingRoutes(r: Hono<AuthVars>, svc: RoutingService): void {
  r.use(BASE, requireAdminRole(), tenantAdminReadOnly()); // CR-127 · E8 · ghi luật định tuyến (= áp dụng) chỉ quản trị nền tảng; GET vẫn xem
  r.use(`${BASE}/processes/*`, requireAdminRole());
  r.on(["PUT", "DELETE"], `${BASE}/processes/*`, requirePlatformAdmin());
  r.get(BASE, async (c) => c.json(await svc.get(c.var.user, tidOf(c), slotOf(c))));
  r.get(`${BASE}/processes/:defId`, async (c) =>
    c.json(await svc.def(c.var.user, tidOf(c), slotOf(c), defOf(c))),
  );
  r.put(BASE, async (c) => {
    const tid = tidOf(c);
    const slot = slotOf(c);
    const b = await parseJson(c, PutProcessRoutingRequestSchema);
    return c.json(await svc.put(c.var.user, tid, slot, b));
  });
  r.put(`${BASE}/processes/:defId`, async (c) =>
    c.json(await svc.assign(c.var.user, tidOf(c), slotOf(c), defOf(c))),
  );
  r.delete(`${BASE}/processes/:defId`, async (c) => {
    await svc.unassign(c.var.user, tidOf(c), slotOf(c), defOf(c));
    return c.body(null, 204);
  });
}
