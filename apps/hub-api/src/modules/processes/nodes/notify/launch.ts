// CR-121 D-6 · node `notify` — chạy: đồng bộ trong tx khoá run (như node `set`), KHÔNG `hub.runs`/agent/job. Ghi thông báo vào
// hàng gửi CÙNG tx (`enqueueRunNotice`, một câu, khoá (run, stage run, lần thử)) → .md kết quả → đường hậu-output (`transition` +
// `effects`): `after: auto` ⇒ done + kick bước kế. Chạy lại (đua kick / sweep) thấy stage không còn `queued` ⇒ bỏ; nếu vẫn tới
// được đây thì `dedup_key` chặn gửi lần 2. Người nhận rỗng ⇒ vẫn xong, .md ghi cảnh báo + log warn. Gửi lỗi ⇒ vòng gửi thử lại.
import { sql } from "drizzle-orm";
import { logger } from "../../../../lib/logger";
import { enqueueRunNotice } from "../../adapters/notify/run-notify.repo";
import { stateOf } from "../../adapters/tools/tool-stage.repo";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import { transition } from "../../domain/runs/run-state.rules";
import { setInputsOf } from "../../domain/set/set.rules";
import type { KickResult, LaunchCtx, LauncherDeps, NodeLauncher } from "../../runs/launch-common";
import { stageRowById } from "../../runs/step-persist";
import { effects, headOf, type SnapStage } from "../../runs/team-runner";
import {
  notifyDedupKey,
  notifyKindOf,
  notifyOutputMd,
  notifyTargets,
  renderNotify,
} from "./notify.rules";

type Tx = Parameters<NodeLauncher["launch"]>[1];

async function launchNotify(d: LauncherDeps, tx: Tx, c: LaunchCtx): Promise<KickResult> {
  const ex = c.def.executor;
  if (ex.kind !== "notify") return { kind: "skip" };
  const tenantId = c.u.tenantId;
  const head = await headOf(tx, c.runId);
  // `queued` → `running` có điều kiện: lần kick đua thứ hai (cùng stage) không chạy lại.
  const moved =
    await tx.execute(sql`update hub.stage_runs set status = 'running', started_at = now(), updated_at = now()
    where id = ${c.stage.id} and tenant_id = ${tenantId} and status = 'queued' returning id`);
  if (moved.length === 0) return { kind: "skip" };
  const stage = await stageRowById(tx, c.runId, c.stage.id, tenantId);
  if (!head || !stage) return { kind: "skip" };
  const inputs = setInputsOf(c.head.inputs);
  const t = notifyTargets(ex, c.u.userId, inputs);
  const title = renderNotify(ex.title, inputs, 200) || c.def.name;
  const sent = await enqueueRunNotice(tx, {
    runId: c.runId,
    tenantId,
    ...t,
    kind: notifyKindOf(ex),
    title,
    body: renderNotify(ex.body, inputs, 2000),
    dedupKey: notifyDedupKey(c.runId, c.stage.id, c.stage.round, c.stage.attempt),
  });
  if (sent.recipients === 0)
    logger.warn("process-notify-no-recipients", { run_id: c.runId, stage_run_id: c.stage.id });
  const def = c.def as unknown as SnapStage;
  const ev = { kind: "stage_output", templateOk: true } as const;
  const tr = transition(stateOf(head, stage, def), ev);
  if (!tr.ok) return { kind: "skip" };
  const x = {
    runId: c.runId,
    stageRunId: c.stage.id,
    hubRunId: "",
    jobId: null,
    result: { kind: "output" as const, text: notifyOutputMd(c.def.name, { ...sent, title }) },
    tokens: 0,
  };
  const ctx = { x, head, stage, def, idx: c.idx, ev, next: tr.next, list: tr.effects };
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
  return { kind: "events", events: res.events, ...(res.kick ? { more: true } : {}) };
}

export const notifyLauncher: NodeLauncher = { launch: launchNotify };
