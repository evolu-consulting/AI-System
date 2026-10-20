// V2-A · HD-11: route mốc HĐ dưới `/pack/contracts` — `POST /contracts/:id/milestones` (201), `PATCH /milestones/:id`,
// `DELETE /milestones/:id` (204). Guard `write` TRƯỚC đọc thân/tham số (viewer ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; thân strict;
// tenant khác ⇒ 404 như không có. Mốc đã xác nhận ⇒ 409 `MILESTONE_CONFIRMED`; SL/tiền sai loại ⇒ 422 `MILESTONE_INVALID`.
import {
  MILESTONE_ERRORS,
  MilestoneCreateSchema,
  type MilestoneErrorCode,
  MilestonePatchSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { MilestoneFail } from "../application/milestones.ports";
import type { MilestoneCommands } from "../application/milestones.usecase";
import { toWrittenMilestone } from "./milestones.mapper";

const KEY = "contracts";
const MESSAGES: Record<MilestoneErrorCode, string> = {
  MILESTONE_CONFIRMED: "Mốc đã xác nhận giữ nguyên, không sửa hoặc xoá được",
  MILESTONE_INVALID:
    "Số lượng chỉ cho mốc Giao hàng; số tiền chỉ cho Thu tiền, Thanh toán, Nhận hoa hồng",
};

function fail(e: unknown): never {
  if (!(e instanceof MilestoneFail)) throw e;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  const code: MilestoneErrorCode =
    e.kind === "confirmed" ? "MILESTONE_CONFIRMED" : "MILESTONE_INVALID";
  throw new AppError(code, MILESTONE_ERRORS[code], MESSAGES[code]);
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(fail);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const uuid = (v: string | undefined) => parseWith(z.uuid(), v);

export function milestonesRoutes(
  view: PackAccessView,
  cmd: MilestoneCommands,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, KEY, "write");
  r.post("/contracts/:id/milestones", write, async (c) => {
    const id = uuid(c.req.param("id"));
    const b = parseWith(MilestoneCreateSchema, await readJson(c));
    return c.json(toWrittenMilestone(await run(cmd.add(who(c), id, b))), 201);
  });
  r.patch("/milestones/:id", write, async (c) => {
    const id = uuid(c.req.param("id"));
    const b = parseWith(MilestonePatchSchema, await readJson(c));
    return c.json(toWrittenMilestone(await run(cmd.edit(who(c), id, b))));
  });
  r.delete("/milestones/:id", write, async (c) => {
    await run(cmd.remove(who(c), uuid(c.req.param("id"))));
    return c.body(null, 204);
  });
  return r;
}
