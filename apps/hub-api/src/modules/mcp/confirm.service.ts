// HUB-FR-95 · HUB-BR-20 · AC-H22 · H2a-R21, R22 · `SideEffectGate` thật (plan-db §3.2): trong một transaction `user`
// (tenant/user của job) tiêu thụ nguyên tử xác nhận `confirmed` cho đúng (flow, agent, workflow, run) → được gọi Dify
// một lần; không có → bước `tool` `failed` CONFIRMATION_REQUIRED + `pending`, trả kết quả xác nhận, **không** gọi Dify.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import { confirmationRequiredResult } from "./confirm.rules";
import * as repo from "./mcp.repo";
import type { SideEffectGate } from "./mcp.service";

export function confirmationGate(d: { db: Db; log: Logger }): SideEffectGate {
  return async (ctx, wf) => {
    const k: repo.ConfirmKey = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      flowId: ctx.flowId,
      runId: ctx.runId,
      agentId: ctx.agentId,
      workflowId: wf.id,
    };
    const scope = { kind: "user", tenantId: ctx.tenantId, userId: ctx.userId } as const;
    const locale = await withHubScope(d.db, scope, async (tx) => {
      if (await repo.consumeConfirmation(tx, k)) return null;
      await repo.requireConfirmation(tx, k);
      return repo.runLocale(tx, ctx.runId, ctx.tenantId);
    });
    if (locale === null) return null;
    d.log.info("tool-confirmation-required", { run_id: ctx.runId, workflow_id: wf.id });
    return confirmationRequiredResult(locale);
  };
}
