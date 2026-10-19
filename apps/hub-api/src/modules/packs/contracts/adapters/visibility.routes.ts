// M1D-FR-04 · docs/specs/M1-departments: chế độ thấy của gói contracts cho tenant — `GET /visibility` (read) và `PUT /visibility`
// (admin = owner gói): `tenant` = mọi thành viên thấy cả tenant (mặc định, hành vi HD1–HD9); `org` = luật mgmt-app (owner thấy
// hết; editor/viewer thấy của mình + cấp dưới + phòng mình làm trưởng + chưa giao mình tải). Luật nằm ở RLS (migration gói 0009);
// route chỉ đọc/ghi một hàng `contracts.visibility_settings` (1 câu + set_config).
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../../lib/errors";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";

export const VisibilityModeSchema = z.enum(["tenant", "org"]);
const PutSchema = z.strictObject({ mode: VisibilityModeSchema });

export function visibilityRoutes(
  view: PackAccessView,
  packKey: string,
  db: Db,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const scope = (u: PackGuardVars["Variables"]["user"]) => ({
    packKey,
    tenantId: u.tenantId,
    userId: u.userId,
  });
  r.get("/visibility", packGuard(view, packKey, "read"), async (c) => {
    const u = c.get("user");
    const rows = await withPackScope(db, scope(u), (tx) =>
      // Chế độ hiệu lực (M1b): hàng cài đặt > mặc định của tenant (tenant mới ⇒ `org`) > `tenant`.
      tx.execute<{ mode: string }>(sql`select contracts.visibility_mode() as mode`),
    );
    return c.json({ mode: rows[0]?.mode ?? "tenant" });
  });
  r.put("/visibility", packGuard(view, packKey, "admin"), async (c) => {
    const u = c.get("user");
    const body = PutSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError("VALIDATION_ERROR", 400, "Invalid request");
    await withPackScope(db, scope(u), (tx) =>
      tx.execute(sql`insert into contracts.visibility_settings (tenant_id, mode, updated_by)
        values (${u.tenantId}::uuid, ${body.data.mode}, ${u.userId}::uuid)
        on conflict (tenant_id) do update set mode = excluded.mode, updated_at = now(),
          updated_by = excluded.updated_by`),
    );
    return c.json({ mode: body.data.mode });
  });
  return r;
}
