// HUB-FR-106 · HUB-FR-109 · HUB-BR-38(b) · AC-PB2-05 · P-b2 plan §3.2 (D5): phần "theo bước" của launcher — file đầu vào
// = output các bước TRƯỚC (R05, stage cùng bước không thấy nhau) và "Hành động thật" = MỌI stage bước liền trước là
// `review` đã Đạt (người xác nhận = người Đạt muộn nhất). Tách khỏi `launcher.ts` (giới hạn 400 dòng). Chạy trong tx kick.
import type { StageRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { clipEntityName, dbHubAudit } from "../../../lib/hub-audit";
import type { RunFile } from "../../attachments/run-files.rules";
import { agentWorkflowIds } from "../../config/config.rules";
import type { ProcessRunInput } from "../../runs/create-run";
import type { ProcessDeps } from "../core/ports";
import { priorStageIdxs, realActionStepCheck, stageIdxsOfStep } from "../core/step.rules";
import type { SnapStage } from "./launcher-prompt";
import { runScopedFileIds } from "./output-attachment";
import { stepsOfSnap } from "./step-persist";

type Deps = Pick<ProcessDeps, "config">;
type Preconfirm = NonNullable<ProcessRunInput["preconfirm"]>;

/** `passedBy` = người cho phép; `preconfirm` chỉ khi agent có workflow `side_effect` (vắng ⇒ tool tự hỏi lại). */
export type RealPre = { preconfirm: Preconfirm | undefined; passedBy: string };

const idList = (xs: readonly number[]) =>
  sql.join(
    xs.map((i) => sql`${i}`),
    sql`, `,
  );

/**
 * D4 · HUB-BR-38(b) · stage `real_action` (agent) ở bước k > 0: `realActionStepCheck(stage bước k−1)` đạt ⇒ cho phép,
 * actor = người Đạt muộn nhất; Hub chèn sẵn xác nhận cho mọi workflow `side_effect` của agent (nếu có). Def cũ (mỗi stage
 * một bước) ⇒ đúng luật P-a (stage i−1).
 */
export async function realActionPre(
  d: Deps,
  tx: Tx,
  p: {
    runId: string;
    tenantId: string;
    idx: number;
    def: SnapStage;
    stages: readonly SnapStage[];
  },
): Promise<RealPre | null> {
  // D4 · C50 · "Hành động thật" ở stage `agent` (chèn xác nhận) HOẶC stage `apply` (Hub tự chạy, không agent — C32).
  if (!p.def.real_action) return null;
  if (p.def.executor.kind !== "agent" && p.def.executor.kind !== "apply") return null;
  const steps = stepsOfSnap({ stages: p.stages });
  const step = steps[p.idx] ?? 0;
  if (step === 0) return null;
  const prevIdxs = stageIdxsOfStep(steps, step - 1);
  if (prevIdxs.length === 0) return null;
  const rows = await tx.execute<{
    stage_idx: number;
    status: StageRunStatus;
    passed_by: string | null;
    passed_at: string | null;
  }>(sql`select stage_idx, status, passed_by,
      to_char(passed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as passed_at
    from hub.stage_runs where process_run_id = ${p.runId} and tenant_id = ${p.tenantId}
      and stage_idx in (${idList(prevIdxs)})`);
  const byIdx = new Map(rows.map((r) => [Number(r.stage_idx), r] as const));
  const prev = prevIdxs.map((i) => {
    const r = byIdx.get(i);
    const after: "review" | "auto" = p.stages[i]?.after.kind === "review" ? "review" : "auto";
    return {
      after,
      status: r?.status ?? ("pending" as StageRunStatus),
      passedBy: r?.passed_by ?? null,
      passedAt: r?.passed_at ?? null,
    };
  });
  const check = realActionStepCheck(prev);
  if (!check.ok) return null;
  // Stage Áp (apply): không agent ⇒ không preconfirm workflow; actor = người Đạt cổng tự-sửa.
  if (p.def.executor.kind !== "agent") return { preconfirm: undefined, passedBy: check.passedBy };
  const agentId = p.def.executor.agent_id;
  const catalog = await d.config.catalog();
  const workflowIds = [...agentWorkflowIds(await d.config.snapshot(), agentId)].filter(
    (id) => catalog.workflows.get(id)?.sideEffect === true,
  );
  const preconfirm = workflowIds.length > 0 ? { agentId, workflowIds } : undefined;
  return { preconfirm, passedBy: check.passedBy };
}

/** D4 · audit `authorize_real_action` (append-only trong tx): actor = người Đạt cổng trước (entity `process_run`). */
export async function auditRealAction(
  tx: Tx,
  p: {
    tenantId: string;
    runId: string;
    actorId: string;
    name: string;
    /** C32 · stage Áp ⇒ null (không agent). */
    agentId: string | null;
    pre: RealPre;
  },
): Promise<void> {
  await dbHubAudit.insert(tx, {
    tenantId: p.tenantId,
    actorId: p.actorId,
    actorUsername: null,
    actorRole: "member",
    action: "authorize_real_action",
    entity: "process_run",
    entityId: p.runId,
    entityName: clipEntityName(p.name),
    hubConfigVersion: null,
    before: null,
    after: null,
    summary: { agent_id: p.agentId, workflow_ids: [...(p.pre.preconfirm?.workflowIds ?? [])] },
  });
}

type PriorRow = {
  stage_idx: number;
  version: number;
  attachment_id: string;
  size: string | number;
  sha256: string;
};

/**
 * D6 · R05 · output đã chốt (`stage_runs.current_output_id`) của các stage thuộc bước TRƯỚC (`priorStageIdxs`) →
 * `RunContext.files` (`s<idx>-v<ver>-<filename>`). PB-R18/#133 · lọc qua `runScopedFileIds` (chỉ attachment thuộc chính
 * run + tenant — ID-05); id lạ bị loại, job stage vẫn tạo.
 */
export async function priorFiles(
  tx: Tx,
  p: { tenantId: string; runId: string; idx: number; stages: readonly SnapStage[] },
): Promise<RunFile[]> {
  const { tenantId, runId, idx, stages } = p;
  const prior = priorStageIdxs(stepsOfSnap({ stages }), idx);
  if (prior.length === 0) return [];
  const rows = await tx.execute<PriorRow>(sql`select o.stage_idx, o.version, o.attachment_id,
      a.size, a.sha256
    from hub.stage_runs s
    join hub.process_outputs o on o.id = s.current_output_id
    join hub.attachments a on a.id = o.attachment_id
    where s.process_run_id = ${runId} and s.stage_idx in (${idList(prior)})
      and o.attachment_id is not null
    order by o.stage_idx`);
  const scoped = await runScopedFileIds(
    tx,
    runId,
    tenantId,
    [...rows].map((r) => r.attachment_id),
  );
  return [...rows]
    .filter((r) => scoped.has(r.attachment_id))
    .map((r) => {
      const filename = stages[Number(r.stage_idx)]?.output.filename ?? "output.md";
      return {
        id: r.attachment_id,
        name: `s${Number(r.stage_idx)}-v${Number(r.version)}-${filename}`,
        mime: "text/markdown" as const,
        size: Number(r.size),
        sha256: r.sha256,
      };
    });
}
