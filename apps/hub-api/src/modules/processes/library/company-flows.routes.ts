// CR-122 · E1b · FLOW2-FR-05..09 · `/tenants/:tid/company-flows*` (danh sách flow công ty). Không logic: role admin (403) → parse
// (400) → service (vai + tenant ở `companyAccess`). Trả lại danh sách sau mỗi thao tác (UI vẽ lại một lần).
import { UuidSchema } from "@ai/contracts/common";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminRole } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { CompanyFlowsService } from "./company-flows.service";
import { FlowSettingsService } from "./flow-settings.service";
import { PartnerConfirmService } from "./partner-confirm.service";

const FlowSettingsSchema = z.strictObject({ flow_triggers: z.boolean() });

const AssignSchema = z.strictObject({ flow_id: UuidSchema });
const EnabledSchema = z.strictObject({ enabled: z.boolean() });
const OrderSchema = z.strictObject({ ids: z.array(UuidSchema).min(1).max(200) });
const P = "/tenants/:tid/company-flows";

export function companyFlowsRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new CompanyFlowsService(d.db, d.packTools);
  const r = new Hono<AuthVars>();
  const fs = new FlowSettingsService(d.db);
  r.use("/tenants/:tid/flow-settings", requireAdminRole()); // CR-123 FR-09: platform_admin hoặc tenant_admin của chính công ty (kiểm ở service); member 403
  r.get("/tenants/:tid/flow-settings", async (c) => c.json(await fs.get(c.var.user, tid(c))));
  r.put("/tenants/:tid/flow-settings", async (c) => {
    const b = await parseJson(c, FlowSettingsSchema);
    return c.json(await fs.put(c.var.user, tid(c), b.flow_triggers));
  });
  // CR-125 · UX-S7 · phần Hub của danh sách điều kiện Đối tác xác nhận (admin-api gộp với hồ sơ/entitlement). Chỉ đọc.
  const pc = new PartnerConfirmService(d.db, () => d.partnerMailbox === true, d.packTools);
  r.use("/tenants/:tid/partner-confirm/*", requireAdminRole());
  r.get("/tenants/:tid/partner-confirm/readiness", async (c) =>
    c.json(await pc.readiness(c.var.user, tid(c))),
  );
  r.use(P, requireAdminRole());
  r.use(`${P}/*`, requireAdminRole());
  const tid = (c: { req: { param(k: string): string } }) => UuidSchema.parse(c.req.param("tid"));
  const id = (c: { req: { param(k: string): string } }) => UuidSchema.parse(c.req.param("id"));
  r.get(P, async (c) => c.json(await svc.list(c.var.user, tid(c))));
  r.post(P, async (c) => {
    const b = await parseJson(c, AssignSchema);
    return c.json(await svc.assign(c.var.user, tid(c), b.flow_id), 201);
  });
  r.get(`${P}/readiness/:flowId`, async (c) =>
    c.json(await svc.readiness(c.var.user, tid(c), UuidSchema.parse(c.req.param("flowId")))),
  );
  r.put(`${P}/order`, async (c) => {
    const b = await parseJson(c, OrderSchema);
    return c.json(await svc.reorder(c.var.user, tid(c), b.ids));
  });
  r.patch(`${P}/:id`, async (c) => {
    const b = await parseJson(c, EnabledSchema);
    return c.json(await svc.setEnabled(c.var.user, tid(c), id(c), b.enabled));
  });
  // CHÚ Ý: `/apply` đăng ký TRƯỚC mọi `POST ${P}/:id` tương lai (Hono khớp theo thứ tự đăng ký — `/:id` đứng trước sẽ nuốt "apply" làm id).
  r.post(`${P}/apply`, async (c) => {
    const b = await parseJson(c, AssignSchema);
    return c.json(await svc.apply(c.var.user, tid(c), b.flow_id));
  });
  r.post(`${P}/:id/clone`, async (c) => c.json(await svc.clone(c.var.user, tid(c), id(c)), 201));
  r.post(`${P}/:id/publish`, async (c) => c.json(await svc.publish(c.var.user, tid(c), id(c))));
  r.post(`${P}/:id/revert`, async (c) => c.json(await svc.revert(c.var.user, tid(c), id(c))));
  return r;
}
