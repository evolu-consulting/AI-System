// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24 · /admin/commands* (spec M2 §3). Chỉ platform_admin.
// Không có POST …/test (FR-23 = M5) và "Lịch sử" (M4). Nhân bản = GET rồi POST (ui-admin 7.4), không endpoint riêng.
import {
  CommandCreateRequestSchema,
  CommandListQuerySchema,
  CommandUpdateRequestSchema,
  ListQueryBase,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import { commandAccess } from "./commands.access";
import {
  type Call,
  type CommandsCtx,
  createCommand,
  deleteCommand,
  getCommand,
  listCommands,
  updateCommand,
} from "./commands.service";

export function commandsRoutes(d: AuthDeps & CommandsCtx): Hono<AppVars> {
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
