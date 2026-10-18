// ADM-FR-73 · plan-d2 §6 · nối module workflow-tools: `ToolsTx.read` = `withScope`, `ToolsTx.write` = `configWrite`
// (audit + `config_changed {entity:"workflow", tenantId}` NOTIFY sau COMMIT). Gắn dưới `/admin/tenants`.
import { type Db, withScope } from "@ai/db";
import type { Context, Hono } from "hono";
import type { AppVars, AuthDeps } from "../../lib/auth-middleware";
import { configWrite } from "../../lib/config/config-write";
import type { TestHooks } from "../../lib/test-hooks";
import { toolAudit } from "./adapters/workflow-tools.mapper";
import { workflowToolsRepo } from "./adapters/workflow-tools.repo";
import { workflowToolsRoutes } from "./adapters/workflow-tools.routes";
import type { ToolsTx } from "./application";

export type WorkflowToolsDeps = AuthDeps & { db: Db; hooks?: TestHooks };

function toolsTx(d: WorkflowToolsDeps, c: Context<AppVars>): ToolsTx {
  const scope = c.get("scope");
  const call = { ctx: d, scope, actor: c.get("actor") };
  return {
    read: (fn) => withScope(d.db, scope, (tx) => fn(workflowToolsRepo(tx))),
    write: (fn) =>
      configWrite(call, "workflow_tool.save", (tx, ch) =>
        fn(workflowToolsRepo(tx), {
          changed: (tenantId) => ch.changed({ entity: "workflow", tenantId }),
          audit: (a) => ch.audit(toolAudit(a)),
        }),
      ),
  };
}

export function mountWorkflowTools(app: Hono<AppVars>, d: WorkflowToolsDeps): void {
  app.route(
    "/admin/tenants",
    workflowToolsRoutes(d, (c) => toolsTx(d, c)),
  );
}
