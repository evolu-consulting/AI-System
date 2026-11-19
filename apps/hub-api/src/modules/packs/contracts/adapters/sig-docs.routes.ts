// CR-188 · BR-188-5 · `GET /my-signatures/:sigId/documents` dưới `/pack/contracts`. Guard quyền gói TRƯỚC; chữ ký phải của chính người gọi
// (đã in bởi người khác ⇒ repo ném 403) trừ quản trị công ty (BR-188-4). Danh sách chỉ gồm HĐ người gọi có quyền mở (RLS trong repo).
import {
  type SigDocsQuery,
  SigDocsQuerySchema,
  type SigDocsResponse,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { AppError } from "../../../../lib/errors";
import { parseQuery } from "../../../../lib/http";
import {
  checkPackAccess,
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/public";
import { decodeCursor, pageOf } from "../domain/sig-docs.rules";
import type { SigDocsFilter, SigDocsPage } from "./sig-docs.repo";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SigDocsDeps = {
  list: (
    who: { tenantId: string; userId: string },
    isAdmin: boolean,
    sigId: string,
    f: SigDocsFilter,
  ) => Promise<SigDocsPage>;
};

async function isAdmin(view: PackAccessView, c: Context<PackGuardVars>): Promise<boolean> {
  const u = c.get("user");
  if (u.role === "tenant_admin") return true;
  const i = await packAccessInput(view, "contracts", u);
  return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
}

export function sigDocsRoutes(view: PackAccessView, d: SigDocsDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/my-signatures/:sigId/documents", packGuard(view, "contracts", "read"), async (c) => {
    const sigId = c.req.param("sigId");
    if (!UUID_RE.test(sigId)) throw new AppError("VALIDATION_ERROR", 400, "Invalid id");
    const q: SigDocsQuery = parseQuery(c, SigDocsQuerySchema);
    const u = c.get("user");
    const rows = await d.list(
      { tenantId: u.tenantId, userId: u.userId },
      await isAdmin(view, c),
      sigId,
      {
        kind: q.kind,
        from: q.from,
        to: q.to,
        cursor: decodeCursor(q.cursor),
      },
    );
    const { items, next } = pageOf(rows);
    return c.json({ items, next_cursor: next } satisfies SigDocsResponse);
  });
  return r;
}
