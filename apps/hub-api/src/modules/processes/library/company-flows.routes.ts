// CR-122 · E1b · FLOW2-FR-05..09 · `/tenants/:tid/company-flows*` (danh sách flow công ty). Không logic: role admin (403) → parse
// (400) → service (vai + tenant ở `companyAccess`). Trả lại danh sách sau mỗi thao tác (UI vẽ lại một lần).
import { UuidSchema } from "@ai/contracts/common";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminRole } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { createCompanyFlow } from "./company-flow-create.service";
import { CompanyFlowsService } from "./company-flows.service";
import { FlowSettingsService } from "./flow-settings.service";
import { PartnerConfirmService } from "./partner-confirm.service";
import { tenantAdminReadOnly } from "./platform-write.middleware";

// CR-127 · E2 · + `claim_release_h` (giờ tự trả việc đã nhận); phạm vi 1..168 kiểm ở service ⇒ 422 `CLAIM_HOURS_RANGE`.
const FlowSettingsSchema = z
  .strictObject({ flow_triggers: z.boolean().optional(), claim_release_h: z.number().optional() })
  .refine((b) => b.flow_triggers !== undefined || b.claim_release_h !== undefined);

// CR-127 · E8/Z7 · POST `…/company-flows` chỉ còn dạng TẠO `{name, app, from:"blank"}` (đã gỡ dạng gán `{flow_id}`).
// `app` bắt buộc với quy trình trống ⇒ service trả 422 `FLOW_APP_REQUIRED` (câu nói cách sửa), không 400 mơ hồ.
const CreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  app: z.string().min(1).max(40).optional(),
  from: z.literal("blank"), // CR-127 Z3c · chỉ sơ đồ trống (Thư viện không còn mẫu Sổ Hợp Tác)
});
const ApplySchema = z.strictObject({ flow_id: UuidSchema });
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
    if (b.claim_release_h !== undefined)
      await fs.putClaimHours(c.var.user, tid(c), b.claim_release_h);
    if (b.flow_triggers === undefined) return c.json(await fs.get(c.var.user, tid(c)));
    return c.json(await fs.put(c.var.user, tid(c), b.flow_triggers));
  });
  // CR-125 · UX-S7 · phần Hub của danh sách điều kiện Đối tác xác nhận (admin-api gộp với hồ sơ/entitlement). Chỉ đọc.
  const pc = new PartnerConfirmService(d.db, () => d.partnerMailbox === true, d.packTools);
  r.use("/tenants/:tid/partner-confirm/*", requireAdminRole());
  r.get("/tenants/:tid/partner-confirm/readiness", async (c) =>
    c.json(await pc.readiness(c.var.user, tid(c))),
  );
  // CR-127 · E8 · BR-10/11: quản trị công ty chỉ xem (GET); mọi route ghi ⇒ 403 `FORBIDDEN_TENANT_ADMIN_WRITE` trước parse/DB
  r.use(P, requireAdminRole(), tenantAdminReadOnly());
  r.use(`${P}/*`, requireAdminRole(), tenantAdminReadOnly());
  const tid = (c: { req: { param(k: string): string } }) => UuidSchema.parse(c.req.param("tid"));
  const id = (c: { req: { param(k: string): string } }) => UuidSchema.parse(c.req.param("id"));
  r.get(P, async (c) => c.json(await svc.list(c.var.user, tid(c))));
  r.post(P, async (c) => {
    const b = await parseJson(c, CreateSchema);
    const made = await createCompanyFlow({ db: d.db }, c.var.user, tid(c), b);
    return c.json({ ...made, ...(await svc.list(c.var.user, tid(c))) }, made.created ? 201 : 200);
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
    const b = await parseJson(c, ApplySchema);
    return c.json(await svc.apply(c.var.user, tid(c), b.flow_id));
  });
  r.post(`${P}/:id/publish`, async (c) => c.json(await svc.publish(c.var.user, tid(c), id(c))));
  return r;
}
