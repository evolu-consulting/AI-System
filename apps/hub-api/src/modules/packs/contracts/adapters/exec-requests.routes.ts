// CR-127 · X3 · spec §4.1: `POST /contracts/:id/hold` · `POST /contracts/:id/release` · `POST /obligations/:id/change-requests` (dời hạn / tách mốc /
// miễn phạt). Guard `write` TRƯỚC đọc thân/tham số (viewer ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; thân strict; tenant khác ⇒ 404 như không có.
// Quyền theo vai (R#18) kiểm ở use case: hold/release = owner ∪ trưởng phòng của owner ∪ quản trị công ty; change-requests = owner ∪ quản trị.
// Áp ngay ⇒ 200; chờ duyệt (có quy trình khớp) ⇒ 202.
import { ChangeRequestSchema, HoldRequestSchema } from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import type { ExecCommands } from "../application/exec-request.usecase";
import { execError, execWho } from "./exec-errors";
import { ledgerError } from "./ledger.routes";

const KEY = "contracts";
const uuid = (v: string | undefined) => parseWith(z.uuid(), v);
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    execError(e);
    return ledgerError(e);
  });
const status = (s: "applied" | "pending") => (s === "pending" ? 202 : 200);

export function execRequestsRoutes(view: PackAccessView, cmd: ExecCommands): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, KEY, "write");
  const hold = (kind: "hold" | "release") => async (c: Context<PackGuardVars>) => {
    const id = uuid(c.req.param("id"));
    const b = parseWith(HoldRequestSchema, await readJson(c));
    const out = await run(cmd[kind](await execWho(view, c), id, b));
    return c.json(out, status(out.state));
  };
  r.post("/contracts/:id/hold", write, hold("hold"));
  r.post("/contracts/:id/release", write, hold("release"));
  r.post("/obligations/:id/change-requests", write, async (c) => {
    const id = uuid(c.req.param("id"));
    const b = parseWith(ChangeRequestSchema, await readJson(c));
    const out = await run(cmd.requestChange(await execWho(view, c), id, b));
    return c.json(out, status(out.state));
  });
  return r;
}
