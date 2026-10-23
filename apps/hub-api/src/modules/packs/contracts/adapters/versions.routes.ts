// CR-097 K2 · UC-04: `GET /contracts/:id/versions/diff?a=&b=` (read) — so sánh trường pháp lý hai phiên bản cùng chuỗi. Repo MỘT câu
// trong tx `PackUow` (role `contracts_rw`, RLS FORCE + luật thấy) + `tenant_id` tường minh. Bản không thấy / khác chuỗi ⇒ 404.
import { VersionDiffQuerySchema } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type {
  VersionDiffRepo,
  VersionDiffUsecase,
  VersionFieldsRow,
} from "../application/version-diff.usecase";

export function versionDiffRepo(tx: Tx, t: string): { versionDiff: VersionDiffRepo } {
  return {
    versionDiff: {
      pair: async (id, a, b) =>
        tx.execute<VersionFieldsRow>(sql`select v.id::text, v.version_no, v.fields from contracts.contracts v
          where v.tenant_id = ${t}::uuid and v.id in (${a}::uuid, ${b}::uuid)
            and v.root_id = (select k.root_id from contracts.contracts k where k.id = ${id}::uuid and k.tenant_id = ${t}::uuid)`),
    },
  };
}

export function versionsRoutes(
  view: PackAccessView,
  diff: VersionDiffUsecase,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/contracts/:id/versions/diff", packGuard(view, "contracts", "read"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const q = parseWith(VersionDiffQuerySchema, { a: c.req.query("a"), b: c.req.query("b") });
    const u = c.get("user");
    const out = await diff({ tenantId: u.tenantId, userId: u.userId }, id, q.a, q.b);
    if (!out) throw appError("NOT_FOUND");
    return c.json(out);
  });
  return r;
}
