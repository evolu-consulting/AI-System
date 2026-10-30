// CR-105 · L2b · `POST /process-defs/:id/preview` (B3): với (loại HĐ, giá trị mẫu) bước nào của quy trình thư viện chạy / bị bỏ qua.
// Chỉ platform_admin (403 trước parse). Đọc `slot_body` của def thư viện (scope system), tính qua `SlotSpec.preview` của khe
// (engine không import gói) — KHÔNG ghi gì.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requirePlatformAdmin } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseIdParam, parseJson, validationError } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { slotSpecOf } from "./slots";

const PreviewRequestSchema = z.strictObject({
  contract_type: z.enum(["buy", "sell", "referral"]),
  value: z.number().finite().nonnegative(),
});

type Row = { slot: string; slot_body: unknown };

export function previewRoutes(d: ProcessDeps): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use("/process-defs/:id/preview", requirePlatformAdmin());
  r.post("/process-defs/:id/preview", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, PreviewRequestSchema);
    const [row] = await withHubScope(d.db, { kind: "system" }, (tx) =>
      tx.execute<Row>(sql`select slot, slot_body from hub.process_defs
        where id = ${id} and tenant_id is null and slot is not null and deleted_at is null`),
    );
    if (!row) throw appError("NOT_FOUND");
    const steps = slotSpecOf(row.slot)?.preview?.(row.slot_body, {
      contractType: b.contract_type,
      value: b.value,
    });
    if (!steps)
      throw validationError([{ path: ["slot_body"], code: "custom", message: "no preview" }]);
    return c.json({ steps: steps.map((s) => ({ key: s.key, name: s.name, run: s.run })) });
  });
  return r;
}
