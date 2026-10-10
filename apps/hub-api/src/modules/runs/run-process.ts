// HUB-FR-105 · HUB-BR-23 · HUB-BR-24 · P-a D1, D3 · chuẩn bị run stage quy trình (chưa ghi DB): run `direct` thường của
// NGƯỜI BẮT ĐẦU trên hội thoại nền quy trình. Stage agent: agent kiểm lại trên ảnh cấu hình theo quyền người bắt đầu
// (`directOnSnapshot` ⇒ 404 `AGENT_NOT_FOUND` khi mất grant). Stage nhóm: không có agent `direct` — driver nhóm (PF1
// `team-runner`) kiểm nhóm bật cho tenant + thành viên `enabled` (C2: không kiểm grant từng thành viên). Không
// `maxConcurrentRuns` (D3: giới hạn bằng run/tenant).
import type { SendMessageRequest } from "@ai/contracts/chat";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { ConfigCache } from "../config/config.service";
import { responderOf } from "../mention/mention.rules";
import { type DirectRunStart, directOnSnapshot } from "../mention/mention.service";
import type { CreateRunInput, ProcessRunInput } from "./create-run";

/** Người thực thi stage (`ProcessStageDef.executor`, id đã chụp trong snapshot run). */
export type StageExecutor = { kind: "agent"; agentId: string } | { kind: "team"; teamId: string };
export type ProcessStage = { executor: StageExecutor; process: ProcessRunInput };

export type ProcessPrep = { conversationId: string; req: SendMessageRequest; stage: ProcessStage };
export type PrepareProcessDeps = { config: ConfigCache; owner: string; log: Logger };

/** C2 · `skipGrant` = thành viên nhóm: agent lấy từ ảnh theo id, KHÔNG kiểm grant người bắt đầu (plan D7, HUB-BR-23). */
export type ProcessPrepOpts = { skipGrant?: boolean };

export async function prepareProcessRun(
  d: PrepareProcessDeps,
  u: AuthUser,
  x: ProcessPrep,
  opts: ProcessPrepOpts = {},
) {
  const snapshot = await d.config.snapshot();
  const user = await d.config.user(u.userId);
  const locale = user?.locale ?? "vi";
  const o = { tenantId: u.tenantId, userId: u.userId };
  const run = {
    id: crypto.randomUUID(),
    ...o,
    conversationId: x.conversationId,
    flowId: x.req.flow_id ?? crypto.randomUUID(),
    answerMessageId: crypto.randomUUID(),
    userMessageId: crypto.randomUUID(),
    locale,
  };
  let direct: DirectRunStart | undefined;
  const ex = x.stage.executor;
  if (ex.kind === "agent") {
    const agent = snapshot.agents.find((a) => a.id === ex.agentId);
    if (!agent) throw appError("AGENT_NOT_FOUND", { suggestions: [] });
    const start: DirectRunStart = {
      ...{ kind: "direct", agent, responder: responderOf(agent, locale), content: x.req.content },
    };
    const who = { ...o, groupIds: user?.groupIds ?? new Set<string>() };
    direct = opts.skipGrant ? start : directOnSnapshot(start, snapshot, who, locale);
  }
  const input: CreateRunInput = {
    run,
    req: x.req,
    configVersion: snapshot.version,
    owner: d.owner,
    direct: direct && { agentId: direct.agent.id, responder: direct.responder },
    mention: direct,
    orchestratorTenantId: null,
    process: x.stage.process,
    log: d.log,
  };
  return { run, snapshot, orchestrator: null, direct, input };
}
