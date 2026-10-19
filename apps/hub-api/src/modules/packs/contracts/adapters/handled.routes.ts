// HD4-FR-06 · HD4-AC06 · plan §3: `POST /pack/contracts/contracts/:id/handled` (editor). Guard `write` TRƯỚC đọc thân (viewer ⇒ 403,
// 0 SQL); `:id` sai dạng ⇒ 400; thân strict, outcome/khoá lạ ⇒ 400 VALIDATION_ERROR (D4-10); tenant khác ⇒ 404; chưa duyệt/phụ lục ⇒ 409.
import { CONTRACT_ERRORS, HandledRequestSchema } from "@ai/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { RecordHandled } from "../application/record-handled.usecase";

const KEY = "contracts";

export function handledRoutes(
  view: PackAccessView,
  d: { record: RecordHandled },
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.post("/contracts/:id/handled", packGuard(view, KEY, "write"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const body = parseWith(HandledRequestSchema, await readJson(c));
    const u = c.get("user");
    const out = await d.record({ tenantId: u.tenantId, userId: u.userId }, id, body.outcome);
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "not_confirmed")
      throw new AppError(
        "CONTRACT_NOT_CONFIRMED",
        CONTRACT_ERRORS.CONTRACT_NOT_CONFIRMED,
        "Contract is not confirmed",
      );
    return c.json(out.out, 200);
  });
  return r;
}
