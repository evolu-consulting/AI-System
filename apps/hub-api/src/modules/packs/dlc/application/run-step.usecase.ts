// dlc-engine · tool `dlc-step` (stage `tool` của khe DLC): đọc lượt (`dlc.flows` theo `processRunId` của stage), kiểm tham số hằng
// của bước, chạy việc của bước. Chỉ chạy trong stage của lượt DLC (`/mcp` không có `processRunId` ⇒ từ chối). Lỗi nghiệp vụ ⇒
// `PackToolBusinessError` (engine không thử lại, mở quyết định cho người: Thử lại / Huỷ). Lớp 2.
import type { PackToolArgs, PackToolCtx } from "../../kit/application/pack-tools.ports";
import { DLC_ACTIONS, DLC_MODES, DLC_ROUNDS, type DlcAction } from "../domain/dlc-flow.rules";
import { agentStep, qcStep, specStep } from "./step-agents";
import { buildStep, setupStep, verifyStep } from "./step-build";
import { fail, type StepArgs, type StepCtx, type StepDeps, type StepOut } from "./step-context";
import { deployStep, intakeStep, reportStep } from "./step-ops";

const RUNNERS: Readonly<Record<DlcAction, (c: StepCtx) => Promise<StepOut>>> = {
  intake: intakeStep,
  spec: specStep,
  qc: qcStep,
  setup: setupStep,
  build: buildStep,
  verify: verifyStep,
  report: reportStep,
  deploy: deployStep,
  agent: agentStep,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tham số hằng của bước (do khe biên dịch) ⇒ kiểu; sai ⇒ lỗi bước. */
export function stepArgsOf(a: PackToolArgs): StepArgs {
  const action = String(a.action ?? "");
  const mode = String(a.mode ?? "");
  if (!(DLC_ACTIONS as readonly string[]).includes(action)) fail(`việc không hợp lệ: ${action}`);
  if (!(DLC_MODES as readonly string[]).includes(mode)) fail(`dây chuyền không hợp lệ: ${mode}`);
  const rounds = Number(a.rounds ?? DLC_ROUNDS.default);
  return {
    action: action as DlcAction,
    mode: mode as StepArgs["mode"],
    step: String(a.step ?? action),
    agent: String(a.agent ?? ""),
    instruction: String(a.instruction ?? ""),
    rounds: Number.isInteger(rounds)
      ? Math.min(Math.max(rounds, DLC_ROUNDS.min), DLC_ROUNDS.max)
      : DLC_ROUNDS.default,
  };
}

export function runDlcStep(d: StepDeps) {
  return async (ctx: PackToolCtx, args: PackToolArgs): Promise<Record<string, unknown>> => {
    const runId = ctx.processRunId ?? "";
    if (!UUID.test(runId)) fail("dlc-step chỉ chạy trong một bước của quy trình DLC");
    const a = stepArgsOf(args);
    const flow = await d.uow.system(ctx.tenantId, (r) => r.flows.get(runId));
    if (!flow) fail("lượt quy trình này không phải lượt DLC (mở bằng dlc-start)");
    if (flow && flow.mode !== a.mode) fail(`bước của dây chuyền ${a.mode} trong lượt ${flow.mode}`);
    const c: StepCtx = {
      d,
      tenantId: ctx.tenantId,
      flow: flow as NonNullable<typeof flow>,
      a,
      feedback: ctx.feedback ?? null,
      signal: ctx.signal,
    };
    return RUNNERS[a.action](c);
  };
}
