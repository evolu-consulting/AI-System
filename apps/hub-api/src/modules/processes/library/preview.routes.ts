// CR-105 · L2b · `POST /process-defs/:id/preview` (B3): với (loại HĐ, giá trị mẫu) bước nào của quy trình thư viện chạy / bị bỏ qua.
// Chỉ platform_admin (403 trước parse). Đọc `slot_body` của def thư viện (scope system), tính qua `SlotSpec.preview` của khe
// (engine không import gói) — KHÔNG ghi gì.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVars } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseIdParam, parseJson, validationError } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { slotSpecOf } from "./slots";

// CR-121 D-2 · mọi dữ kiện đều tuỳ chọn: vắng/null ⇒ bước có điều kiện đó trả `state: "no_data"` ("chưa có dữ liệu").
const PreviewRequestSchema = z.strictObject({
  contract_type: z.enum(["buy", "sell", "referral"]).nullish(),
  value: z.number().finite().nonnegative().nullish(),
  creator_departments: z.array(z.string().min(1).max(64)).max(50).nullish(),
  new_partner: z.boolean().nullish(),
});

type Row = { slot: string; slot_body: unknown };

/** platform_admin: def thư viện (khe của chính nó). tenant_admin (c17b): CHỈ bản riêng của công ty mình — khe lấy từ def nguồn còn sống. */
const readRow = (d: ProcessDeps, id: string, u: { role: string; tenantId: string | null }) =>
  withHubScope(
    d.db,
    { kind: "system" },
    (tx) =>
      u.role === "platform_admin"
        ? tx.execute<Row>(sql`select slot, slot_body from hub.process_defs
        where id = ${id} and tenant_id is null and slot is not null and deleted_at is null`)
        : tx.execute<Row>(sql`select s.slot, d.slot_body from hub.process_defs d
        join hub.process_defs s on s.id = d.source_template_id and s.slot is not null and s.deleted_at is null
        where d.id = ${id} and d.tenant_id = ${u.tenantId} and d.slot_body is not null and d.deleted_at is null`),
    { accessMode: "read only" }, // xem trước không ghi gì
  );

export function previewRoutes(d: ProcessDeps): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  // 403 trước parse: member không xem trước được.
  r.use("/process-defs/:id/preview", async (c, next) => {
    const role = c.get("user")?.role;
    if (role !== "platform_admin" && role !== "tenant_admin") throw appError("FORBIDDEN");
    await next();
  });
  r.post("/process-defs/:id/preview", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, PreviewRequestSchema);
    const [row] = await readRow(d, id, c.get("user"));
    if (!row) throw appError("NOT_FOUND");
    const steps = slotSpecOf(row.slot)?.preview?.(row.slot_body, {
      contractType: b.contract_type ?? null,
      value: b.value ?? null,
      creatorDepartments: b.creator_departments ?? null,
      newPartner: b.new_partner ?? null,
    });
    if (!steps)
      throw validationError([{ path: ["slot_body"], code: "custom", message: "no preview" }]);
    return c.json({
      steps: steps.map((s) => ({ key: s.key, name: s.name, run: s.run, state: s.state })),
    });
  });
  return r;
}
