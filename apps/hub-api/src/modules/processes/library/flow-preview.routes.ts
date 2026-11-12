// CR-127 · E7 · BR-17 · `POST /tenants/:tid/flow-preview` (một lượt) và `…/flow-preview/scenarios` (4 trường hợp). CHỈ platform_admin
// (403 trước parse — quản trị công ty xem kết quả ở bản của mình qua màn khác, không chạy thử). Thay `preview.routes.ts` (khe cũ).
import { PROCESS_STAGES_CEILING } from "@ai/contracts/chat";
import { UuidSchema } from "@ai/contracts/common";
import { ProcessStageDefSchema } from "@ai/contracts/hub-admin";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireAdminRole } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { FlowPreviewService, type PreviewRequest } from "./flow-preview.service";

const FactSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(64)).max(50),
  z.null(),
]);
const BaseShape = {
  flow_id: UuidSchema.optional(),
  draft: z
    .strictObject({
      event: z.string().max(80).nullish(),
      stages: z.array(ProcessStageDefSchema).min(1).max(PROCESS_STAGES_CEILING),
    })
    .optional(),
  facts: z.record(z.string().max(64), FactSchema).default({}),
  starter_user_id: UuidSchema.nullish(),
  at: z.string().datetime().optional(),
};
const oneOf = (b: { flow_id?: unknown; draft?: unknown }) =>
  (b.flow_id === undefined) !== (b.draft === undefined);
const ONE = { message: "Chọn một: flow_id hoặc draft" };
const RunSchema = z
  .strictObject({
    ...BaseShape,
    decisions: z
      .array(
        z.strictObject({
          step_key: z.string().max(64),
          result: z.enum(["approve", "return", "reject"]),
          actor_user_id: UuidSchema.nullish(),
        }),
      )
      .max(40)
      .default([]),
  })
  .refine(oneOf, ONE);
const ScenariosSchema = z.strictObject(BaseShape).refine(oneOf, ONE);

const P = "/tenants/:tid/flow-preview";

export function flowPreviewRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new FlowPreviewService(d.db);
  const r = new Hono<AuthVars>();
  const tid = (c: Context) => UuidSchema.parse(c.req.param("tid"));
  const platformOnly = async (c: Context<AuthVars>, next: Next) => {
    if (c.get("user").role !== "platform_admin") throw appError("FORBIDDEN"); // trước parse
    await next();
  };
  r.use(P, requireAdminRole(), platformOnly);
  r.use(`${P}/*`, requireAdminRole(), platformOnly);
  r.post(P, async (c) =>
    c.json(await svc.run(c.var.user, tid(c), (await parseJson(c, RunSchema)) as PreviewRequest)),
  );
  r.post(`${P}/scenarios`, async (c) =>
    c.json(
      await svc.scenarios(
        c.var.user,
        tid(c),
        (await parseJson(c, ScenariosSchema)) as PreviewRequest,
      ),
    ),
  );
  return r;
}
