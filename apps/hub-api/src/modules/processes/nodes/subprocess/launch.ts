// CR-125 · node `subprocess` — chạy (tx scope user người bắt đầu, run cha ĐÃ khoá FOR UPDATE): mở MỘT lượt con (cùng công ty, cùng người
// bắt đầu, không tính trần lượt/công ty — lượt cha đã tính) + ghi liên kết cha trong CÙNG tx (unique ⇒ kick lại / thử lại cùng lần chạy
// không mở lượt thứ hai), stage cha `waiting_timer` (KHÔNG hẹn, không poll) ⇒ kick lượt con SAU COMMIT. Lượt con kết thúc ⇒ trigger 0129
// ghi hẹn tới hạn ngay ⇒ vòng hẹn giờ chốt bước cha (`finishWait`). Vào lại khi lượt con đã lỗi/hết hạn (`finishWait` trả stage về queued)
// ⇒ «Cần xử lý» `tool_failed` (Thử lại = attempt mới ⇒ lượt con mới). Lồng quá `SUBPROCESS_DEPTH_MAX` / không thấy quy trình ⇒ như vậy.
import { type ProcessInputValue, SUBPROCESS_DEPTH_MAX } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../../lib/errors";
import { ifFacts } from "../../adapters/runs/if-facts.repo";
import { settleStepTx } from "../../adapters/runs/step.repo";
import { waitRepo } from "../../adapters/timers/wait.repo";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import { isTerminal } from "../../domain/runs/run-state.rules";
import { mappedValues } from "../../domain/runs/subprocess.rules";
import type { ProcessRunStatus } from "../../domain/types";
import type { KickResult, LaunchCtx, LauncherDeps, NodeLauncher } from "../../runs/launch-common";
import type { StartDefRow } from "../../runs/runs.repo";
import { createRun } from "../../runs/start-inputs";
import { toDecision } from "../../runs/team-runner";
import { ancestorDepth, childOfStage, linkChild } from "./subprocess.repo";
import { resolveSubprocessDef } from "./subprocess-def";

type Exec = { kind: "subprocess"; def_key: string; input_map?: Record<string, string> };

export const subprocessLauncher: NodeLauncher = {
  async launch(d, tx, c) {
    const ex = c.def.executor as unknown as Exec;
    if (ex.kind !== "subprocess") return { kind: "skip" };
    const tenantId = c.u.tenantId;
    const s = { id: c.stage.id, attempt: Number(c.stage.attempt), round: Number(c.stage.round) };
    const child = await childOfStage(tx, tenantId, s);
    if (child) {
      if (!isTerminal(child.status as ProcessRunStatus)) return waiting(d, tx, c, null);
      if (child.status === "failed" || child.status === "expired") return failed(d, tx, c);
      // Lượt con đã xong mà stage cha bị đưa lại hàng đợi ⇒ chờ + hẹn tới hạn ngay (vòng hẹn giờ chốt như đường thường).
      await waiting(d, tx, c, null);
      await dueNow(tx, tenantId, c, `sub:${child.id}:${d.now().getTime()}`);
      return { kind: "events", events: [] };
    }
    if ((await ancestorDepth(tx, tenantId, c.runId)) >= SUBPROCESS_DEPTH_MAX)
      return failed(d, tx, c);
    const def = await resolveSubprocessDef(d, tx, tenantId, ex.def_key);
    if (!def) return failed(d, tx, c);
    const childId = await openChild(d, tx, c, { def, map: ex.input_map });
    if (!childId) return failed(d, tx, c);
    await linkChild(tx, tenantId, childId, { runId: c.runId, stageRunId: s.id, ...s });
    return waiting(d, tx, c, childId);
  },
};

/** Tạo lượt con trong SAVEPOINT: đầu vào con sai (thiếu / sai kiểu) ⇒ null (bước cha «Cần xử lý»), tx cha vẫn dùng được. */
async function openChild(
  d: LauncherDeps,
  tx: Tx,
  c: LaunchCtx,
  o: { def: StartDefRow; map: Record<string, string> | undefined },
): Promise<string | null> {
  const inputs = await childInputs(tx, c, o);
  try {
    const r = await tx.transaction((sp) =>
      createRun(
        sp as unknown as Tx,
        c.u,
        {
          def: o.def,
          input: "",
          // = origin `none` của `originOf` (không phòng / hội thoại).
          origin: { originKind: "admin", originRoomId: null, originConversationId: null },
          inputs,
        },
        { runsPerTenant: d.runsPerTenant, now: d.now, kh: d.kh, packBound: true },
      ),
    );
    return r.runId;
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      d.log.warn("process-subprocess-start-refused", { run_id: c.runId, code: err.code });
      return null;
    }
    throw err;
  }
}

/** `input_map` ⇒ giá trị đầu vào lượt con theo kiểu khai của def con (text/select/date/number). */
async function childInputs(
  tx: Tx,
  c: LaunchCtx,
  o: { def: StartDefRow; map: Record<string, string> | undefined },
): Promise<ProcessInputValue[]> {
  if (!o.map || Object.keys(o.map).length === 0) return [];
  const facts = await ifFacts(tx, c.u.tenantId, c.runId);
  const byStageKey: Record<string, Record<string, string | number>> = {};
  c.head.snapshot.stages.forEach((st, i) => {
    const f = facts.fieldsByIdx[String(i)];
    const key = (st as { key?: string }).key;
    if (f && key) byStageKey[key] = f;
  });
  const vals = mappedValues(o.map, { byStageKey, inputs: facts.inputs });
  return (o.def.inputs ?? []).flatMap((inp): ProcessInputValue[] => {
    const v = vals[inp.key];
    if (v === undefined) return [];
    if (inp.type === "text") return [{ type: "text", key: inp.key, text: v }];
    if (inp.type === "select" || inp.type === "date" || inp.type === "number")
      return [{ type: inp.type, key: inp.key, value: v }];
    return [];
  });
}

/** Stage cha `waiting_timer` + trạng thái lượt theo bước + `process.updated`; lượt con mới ⇒ kick sau COMMIT. */
async function waiting(
  d: LauncherDeps,
  tx: Tx,
  c: LaunchCtx,
  childId: string | null,
): Promise<KickResult> {
  const tenantId = c.u.tenantId;
  await waitRepo(tx, tenantId).markWaiting(c.stage.id, d.now());
  const recipients = await core.runRecipients(tx, c.runId, tenantId);
  const step = await settleStepTx(tx, c.runId, tenantId);
  const kicks = childId ? [childId] : [];
  if (!step) return { kind: "events", events: [], kicks };
  const run = { id: c.runId, status: step.status, stageIdx: step.stageIdx, step: step.step };
  return { kind: "events", events: processUpdated(recipients, run), kicks };
}

/** Lượt con lỗi / không mở được ⇒ bước cha «Cần xử lý» như tool lỗi (Thử lại / Bỏ qua / Dừng). */
async function failed(d: LauncherDeps, tx: Tx, c: LaunchCtx): Promise<KickResult> {
  const tenantId = c.u.tenantId;
  const p = { runId: c.runId, tenantId, idx: c.idx, stageRunId: c.stage.id };
  const events = await toDecision(d, tx, { ...p, reason: "tool_failed" });
  const recipients = await core.runRecipients(tx, c.runId, tenantId);
  events.push(
    ...processUpdated(recipients, { id: c.runId, status: "needs_decision", stageIdx: c.idx }),
  );
  return { kind: "events", events };
}

async function dueNow(tx: Tx, tenantId: string, c: LaunchCtx, key: string): Promise<void> {
  await tx.execute(sql`insert into hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at,
      timezone, idempotency_key)
    values (${tenantId}, ${c.runId}, ${c.stage.id}, 'wait_until', now(), 'UTC', ${key})
    on conflict (idempotency_key) do nothing`);
}
