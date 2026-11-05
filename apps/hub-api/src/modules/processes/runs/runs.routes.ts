// HUB-FR-105 · HUB-FR-113 · ADM-FR-67 · PF1 · `GET /processes`, `POST /process-runs`, `GET /process-runs`,
// `GET /process-runs/:id` + `/outputs/:oid` (plan §9, plan-contract §3). Mount sẵn ở `processes.mount.ts`.
// cancel/decide/review-decision ⇒ B6a (`gates/**`).

import {
  CreateProcessRunRequestSchema,
  PROCESS_RUN_ID_HEADER,
  ProcessRunListQuerySchema,
  RUN_DETAIL_STEPS_MAX,
} from "@ai/contracts/chat";
import { UuidSchema } from "@ai/contracts/common";
import { type Context, Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { parseJson, parseQuery } from "../../../lib/http";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { RunDetailService } from "./run-detail.service";
import { StartService } from "./start.service";
import { ViewService } from "./view.service";

/** `?tenant_id` của platform_admin (chọn tenant đích, plan §5). `parseQuery` bỏ khoá phạm vi (H1-R03) nên đọc thô
 * ở đây; chỉ platform_admin được tôn trọng (kiểm trong service `scopeOf`). uuid sai ⇒ bỏ qua. */
export const tenantIdQuery = (c: Context<AuthVars>): string | undefined => {
  const t = c.req.query("tenant_id");
  return t && UuidSchema.safeParse(t).success ? t : undefined;
};

/** Như `tenantIdQuery` nhưng `?tenant_id` sai định dạng ⇒ 422 câu rõ (trang chi tiết admin không bỏ qua im lặng). */
const strictTenantId = (c: Context<AuthVars>): string | undefined => {
  const t = c.req.query("tenant_id");
  if (t === undefined) return undefined;
  if (!UuidSchema.safeParse(t).success)
    throw new AppError("TENANT_ID_INVALID", 422, "tenant_id must be a valid UUID", {
      field: "tenant_id",
    });
  return t;
};

export function processRunsRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new StartService(d);
  const view = new ViewService(d);
  const detail = new RunDetailService(d);
  const r = new Hono<AuthVars>();

  r.get("/processes", async (c) => c.json({ items: await svc.catalog(c.var.user) }));

  r.post("/process-runs", async (c) => {
    const body = await parseJson(c, CreateProcessRunRequestSchema);
    const run = await svc.createFromApi(c.var.user, body);
    c.header(PROCESS_RUN_ID_HEADER, run.id);
    return c.json(run, 201);
  });

  r.get("/process-runs", async (c) => {
    const q = parseQuery(c, ProcessRunListQuerySchema);
    return c.json(await svc.list(c.var.user, q, tenantIdQuery(c)));
  });

  r.get("/process-runs/:id", async (c) =>
    c.json(await view.get(c.var.user, c.req.param("id"), tenantIdQuery(c))),
  );

  // CR-121 · R-2 · trang chi tiết lượt chạy (admin) + nhật ký một bước (mức basic/debug do vai quyết ở service).
  const notFound = () => processError("PROCESS_NOT_FOUND", { suggestions: [] });
  r.get("/process-runs/:id/detail", async (c) => {
    if (!UuidSchema.safeParse(c.req.param("id")).success) throw notFound();
    return c.json(await detail.detail(c.var.user, c.req.param("id"), strictTenantId(c)));
  });

  r.get("/process-runs/:id/stages/:idx/log", async (c) => {
    const idx = Number(c.req.param("idx"));
    if (!UuidSchema.safeParse(c.req.param("id")).success) throw notFound();
    if (!Number.isInteger(idx) || idx < 0 || idx >= RUN_DETAIL_STEPS_MAX) throw notFound();
    return c.json(await detail.stageLog(c.var.user, c.req.param("id"), idx, strictTenantId(c)));
  });

  r.get("/process-runs/:id/outputs/:oid", async (c) =>
    c.json(await view.output(c.var.user, c.req.param("id"), c.req.param("oid"), tenantIdQuery(c))),
  );

  return r;
}
