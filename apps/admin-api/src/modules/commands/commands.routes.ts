// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-23, ADM-FR-24 · /admin/commands* (spec M2 §3, X1 §2.2). Chỉ platform_admin.
// `POST /test` chạy thử bản nháp (không id) qua Hub. Nhân bản = GET rồi POST (ui-admin 7.4), không endpoint riêng.
import {
  CommandCreateRequestSchema,
  CommandListQuerySchema,
  CommandTestRequestSchema,
  CommandUpdateRequestSchema,
  ListQueryBase,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import { commandAccess } from "./commands.access";
import { type HubConfig, hubWaitS } from "./commands.hub-client";
import {
  type Call,
  type CommandsCtx,
  createCommand,
  deleteCommand,
  getCommand,
  listCommands,
  updateCommand,
} from "./commands.service";
import { runCommandTest } from "./commands.test-run";

/** Bun `Server.timeout(req, s)`: idle mặc định 10 s cắt request chạy thử dài (mẫu Hub `testRunIdleS`). */
type IdleTimeoutControl = { timeout?: (req: Request, seconds: number) => void };
const IDLE_EXTRA_S = 5;

export function commandsRoutes(d: AuthDeps & CommandsCtx & { hub?: HubConfig }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin"));

  r.get("/", async (c) =>
    c.json(await listCommands(call(c), parseQuery(c, CommandListQuerySchema))),
  );
  r.post("/", async (c) => {
    const input = await parseJson(c, CommandCreateRequestSchema);
    return c.json(await createCommand(call(c), input), 201);
  });
  r.post("/test", async (c) => {
    const input = await parseJson(c, CommandTestRequestSchema);
    (c.env as IdleTimeoutControl | undefined)?.timeout?.(
      c.req.raw,
      hubWaitS(input.command.timeout_s) + IDLE_EXTRA_S,
    );
    const out = await runCommandTest({ ...call(c), hub: d.hub }, input, c.req.raw.signal);
    if (!out) return new Response(null, { status: 499 });
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { "content-type": "application/json" },
    });
  });
  r.get("/:id", async (c) => c.json(await getCommand(call(c), parseIdParam(c))));
  r.get("/:id/access", async (c) => {
    const id = parseIdParam(c);
    return c.json(await commandAccess(call(c), id, parseQuery(c, ListQueryBase)));
  });
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, CommandUpdateRequestSchema);
    return c.json(await updateCommand(call(c), id, input));
  });
  r.delete("/:id", async (c) => {
    await deleteCommand(call(c), parseIdParam(c));
    return c.body(null, 204);
  });
  return r;
}
