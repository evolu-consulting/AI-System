// CR-103 · R4 · node `set` — chạy: đồng bộ trong tx khoá run, KHÔNG tạo `hub.runs`/agent/job. Dựng `fields` từ input run
// (`setFields`) → ghi output `.md` (khối ```fields) → đi đường hậu-output như stage agent/tool (`transition` + `effects`):
// `after: auto` ⇒ done + join bước (kick bước kế); `after: review` ⇒ waiting_review + task duyệt (cổng, nhắc, chuyển cấp).
import { sql } from "drizzle-orm";
import { stateOf } from "../../adapters/tools/tool-stage.repo";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import { transition } from "../../domain/runs/run-state.rules";
import { setFields, setInputsOf, setOutputMd } from "../../domain/set/set.rules";
import type { KickResult, LaunchCtx, LauncherDeps, NodeLauncher } from "../../runs/launch-common";
import { stageRowById } from "../../runs/step-persist";
import { effects, headOf, type SnapStage } from "../../runs/team-runner";

type Tx = Parameters<NodeLauncher["launch"]>[1];

async function launchSet(d: LauncherDeps, tx: Tx, c: LaunchCtx): Promise<KickResult> {
  const ex = c.def.executor;
  if (ex.kind !== "set") return { kind: "skip" };
  const tenantId = c.u.tenantId;
  const head = await headOf(tx, c.runId);
  // `queued` → `running` (state machine chỉ nhận output từ stage đang chạy); cùng tx nên không ai thấy trạng thái giữa.
  await tx.execute(sql`update hub.stage_runs set status = 'running', started_at = now(), updated_at = now()
    where id = ${c.stage.id} and tenant_id = ${tenantId}`);
  const stage = await stageRowById(tx, c.runId, c.stage.id, tenantId);
  if (!head || !stage) return { kind: "skip" };
  const def = c.def as unknown as SnapStage;
  const declared = (c.def as { output: { fields?: { key: string; type: string }[] } }).output
    .fields;
  const fields = setFields(ex, setInputsOf(c.head.inputs), declared ?? []);
  const ev = { kind: "stage_output", templateOk: true } as const;
  const t = transition(stateOf(head, stage, def), ev);
  if (!t.ok) return { kind: "skip" };
  const x = {
    runId: c.runId,
    stageRunId: c.stage.id,
    hubRunId: "",
    jobId: null,
    result: { kind: "output" as const, text: setOutputMd(c.def.name, fields) },
    tokens: 0,
  };
  const ctx = { x, head, stage, def, idx: c.idx, ev, next: t.next, list: t.effects };
  // Không blob/attachment (như stage tool/Áp): .md nhỏ, inline.
  const res = await effects({ ...d, storage: undefined }, tx, ctx);
  if (res.step) {
    const recipients = await core.runRecipients(tx, c.runId, tenantId);
    const u = {
      id: c.runId,
      status: res.step.status,
      stageIdx: res.step.stageIdx,
      step: res.step.step,
    };
    res.events.push(...processUpdated(recipients, u));
  }
  // `more`: `after: auto` xong bước ⇒ kick bước kế; `review` ⇒ dừng chờ người duyệt.
  // Không có `kick` ⇒ KHÔNG đặt `more` (giữ `more` của hàng đợi bước: còn stage song song queued thì vẫn kick tiếp).
  return { kind: "events", events: res.events, ...(res.kick ? { more: true } : {}) };
}

export const setLauncher: NodeLauncher = { launch: launchSet };
