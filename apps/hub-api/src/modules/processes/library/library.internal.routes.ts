// CR-105 · L5 · `PUT /internal/tenants/:tid/process-slots/:slot {process_key, actor}` — admin-api (onboarding) gán quy trình thư viện
// theo KEY, không dùng JWT platform_admin: token dịch vụ `HUB_INTERNAL_TOKEN` (như `/internal/test-run`; 401 sai/thiếu, 503 chưa cấu
// hình). `actor` = uuid platform_admin đã được admin-api kiểm (`actorOk`); ghi audit mang actor đó. Tái dùng `LibraryService.assign`
// (B2 kiểm Group theo tenant, 422 SLOT_GROUPS_MISSING / PROCESS_NOT_PUBLISHED). Không logic riêng.
import { SlotKeySchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthUser } from "../../../lib/auth.middleware";
import { parseJson, validationError } from "../../../lib/http";
import { requireServiceToken } from "../../internal/test-run.auth";
import type { ProcessDeps } from "../core/ports";
import { LibraryService } from "./library.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const InternalAssignSchema = z.strictObject({
  process_key: z.string().min(1).max(64),
  actor: z.string().regex(UUID),
});
const NIL_TENANT = "00000000-0000-0000-0000-000000000000";

export function libraryInternalRoutes(d: ProcessDeps, internalToken: string | undefined): Hono {
  const svc = new LibraryService(d);
  const r = new Hono();
  r.put("/tenants/:tid/process-slots/:slot", requireServiceToken(internalToken), async (c) => {
    const tid = c.req.param("tid") ?? "";
    const slot = c.req.param("slot") ?? "";
    if (!UUID.test(tid) || !SlotKeySchema.safeParse(slot).success)
      throw validationError([{ path: ["params"], code: "custom", message: "Invalid params" }]);
    const b = await parseJson(c, InternalAssignSchema);
    const actor: AuthUser = { userId: b.actor, tenantId: NIL_TENANT, role: "platform_admin" };
    return c.json(await svc.assignByKey(actor, tid, slot, b.process_key));
  });
  return r;
}
