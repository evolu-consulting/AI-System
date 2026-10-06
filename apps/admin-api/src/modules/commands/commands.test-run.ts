// ADM-FR-23 · "Chạy thử" bản nháp lệnh (plan X1 §2.2): precheck (bước 3–6) → Hub `/internal/test-run` → ánh xạ 8a–8f.
// Không ghi DB, không audit. Log một dòng `command-test` — không log text/output/header/token.
import { COMMAND_TEST_ERRORS, type CommandTestRequest } from "@ai/contracts";
import { withScope } from "@ai/db";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { callHubTestRun, type HubConfig } from "./commands.hub-client";
import * as repo from "./commands.repo";
import type { Call } from "./commands.service";
import {
  COMMAND_TEST_MESSAGES,
  type HubMapped,
  mapHubTestRun,
  testRunPrecheck,
} from "./commands.test-run.rules";

export type TestRunCall = Call & { hub: HubConfig | undefined };

async function precheck(c: TestRunCall, input: CommandTestRequest): Promise<HubConfig> {
  const workflowId = input.command.workflow_id;
  const requested = input.run_as_user_id;
  const found = c.hub
    ? await withScope(c.ctx.db, c.scope, async (tx) => ({
        workflow: await repo.workflowForTest(tx, workflowId),
        runAsExists: requested === undefined ? true : await repo.userExists(tx, requested),
      }))
    : { workflow: null, runAsExists: false };
  const r = testRunPrecheck({
    hubConfigured: c.hub !== undefined,
    workflow: found.workflow,
    workflowId,
    confirm: input.confirm_side_effect,
    runAs: { requested, exists: found.runAsExists },
  });
  if (r.ok && c.hub) return c.hub;
  const code = r.ok ? "HUB_NOT_CONFIGURED" : r.code;
  const status = code === "INVALID_REFERENCE" ? 400 : COMMAND_TEST_ERRORS[code];
  const message =
    code === "INVALID_REFERENCE" ? "Referenced item does not exist" : COMMAND_TEST_MESSAGES[code];
  throw new AppError(code, status, message, r.ok ? undefined : r.details);
}

/** `null` = client đã huỷ (8g): route trả không body. */
export async function runCommandTest(
  c: TestRunCall,
  input: CommandTestRequest,
  clientSignal: AbortSignal,
): Promise<HubMapped | null> {
  const hub = await precheck(c, input);
  const t0 = performance.now();
  let res: Awaited<ReturnType<typeof callHubTestRun>>;
  try {
    res = await callHubTestRun(
      hub,
      {
        command: input.command,
        text: input.text,
        context: input.context,
        actor_user_id: input.run_as_user_id ?? c.actor.userId,
      },
      clientSignal,
    );
  } catch {
    logger.info("command-test", { workflow_id: input.command.workflow_id, aborted: true });
    return null;
  }
  const out = mapHubTestRun(res.status, res.body);
  if (res.status === 401 || res.status === 503) {
    logger.warn("command-test.hub-auth", { hub_status: res.status });
  }
  const body = out.body as { ok?: unknown };
  logger.info("command-test", {
    workflow_id: input.command.workflow_id,
    ok: out.status === 200 ? body.ok === true : false,
    ms: Math.round(performance.now() - t0),
    hub_status: res.status,
    status: out.status,
  });
  return out;
}
