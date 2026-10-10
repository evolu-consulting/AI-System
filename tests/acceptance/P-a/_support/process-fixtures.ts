// HUB-FR-104…113 · fixture SQL owner cho bảng 0019 (plan §2.1, §2.2, plan-thread §3). CHỈ gọi khi `hasPaSchema` = true.
// Dựng run ở trạng thái bất kỳ (test-plan §1: PF2 `waiting_answer`, PF3 `review_tasks`, PF4 usage) mà không cần PF1.
// Mọi jsonb qua `sql.json` (CONVENTIONS §2 bẫy). Tham số ghi đè chỉ áp cho lần gọi (không gán biến module).

import { T } from "../../H1/_fixtures";
import type { Json, Sql } from "../../X2b/_x2b";
import { AGB } from "../../X2b/_x2b";

export { allParts, KINDS, part } from "./parts";

let seqN = 0;
const gen = () => `a5a00000-0000-4000-8000-${String(900_000 + seqN++).padStart(12, "0")}`;
/** uuid tất định cho hàng fixture (dải `a5a0…0009xxxxx`). */
export const fixId = gen;

type Who = { id: string; tid: string; display_name?: string; username?: string };

// ---------- định nghĩa quy trình (plan-contract §6) ----------
export function stageDef(o: Json = {}): Json {
  return {
    key: o.key ?? "doc",
    name: o.name ?? "Đọc hoá đơn",
    executor: o.executor ?? { kind: "agent", agent_id: AGB.hoadon },
    instruction: o.instruction ?? "Đọc và tóm tắt hoá đơn.",
    output: o.output ?? {
      filename: "hoa-don.md",
      template: "## Bảng ý\n\n## Số tiền\n",
      required_sections: ["Bảng ý", "Số tiền"],
      fields: [],
    },
    after: o.after ?? { kind: "review", group_id: null },
    real_action: o.real_action ?? false,
    answerer: o.answerer ?? { kind: "starter" },
    timeout_s: o.timeout_s ?? 600,
    token_budget: o.token_budget ?? null,
  };
}
/** `ProcessDefInput` hợp lệ: 2 stage (review rồi real_action). */
export function defInput(o: Json = {}): Json {
  return {
    key: o.key ?? "hoa-don-t",
    name: o.name ?? "Hoá đơn thử",
    description: o.description ?? "Quy trình hoá đơn của bộ test P-a.",
    input_hint: o.input_hint ?? "Số hoá đơn",
    run_group_ids: o.run_group_ids ?? [],
    stages: o.stages ?? [
      stageDef({ key: "doc", after: { kind: "review", group_id: o.groupId ?? null } }),
      stageDef({ key: "ghi", name: "Ghi sổ", after: { kind: "auto" }, real_action: true }),
    ],
    token_budget: o.token_budget ?? null,
    enabled: o.enabled ?? true,
  };
}

export async function insertDef(
  sql: Sql,
  o: { id: string; tenantId: string | null; input?: Json; isTemplate?: boolean },
): Promise<string> {
  const d = o.input ?? defInput();
  await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, stages, token_budget, enabled,
      version)
    values (${o.id}, ${o.tenantId}, ${d.key}, ${d.name}, ${d.description}, ${d.input_hint}, ${sql.json(d.stages)},
      ${d.token_budget}, ${d.enabled}, 1)`;
  return o.id;
}

// ---------- run (plan §2.1 `process_runs`, `stage_runs`) ----------
export type RunFix = { runId: string; convId: string; flowId: string; stageRunIds: string[] };
export type RunOpts = {
  def: { id: string; key: string; name: string; stages: Json[] };
  startedBy: Who;
  /** phòng nguồn (`origin_kind=room`); vắng ⇒ `admin`. */
  roomId?: string | null;
  status?: string;
  stageIdx?: number;
  /** trạng thái stage hiện tại (mặc định suy từ `status`). */
  stageStatus?: string;
  input?: string;
  decision?: Json | null;
  startedAt?: Date;
};
const STAGE_OF: Record<string, string> = {
  running: "running",
  waiting_review: "waiting_review",
  waiting_answer: "waiting_answer",
  needs_decision: "needs_decision",
  done: "done",
  cancelled: "cancelled",
  failed: "failed",
  expired: "cancelled",
};

export async function insertRun(sql: Sql, o: RunOpts): Promise<RunFix> {
  const runId = gen();
  const convId = gen();
  const flowId = gen();
  const tid = o.startedBy.tid;
  const status = o.status ?? "running";
  const idx = o.stageIdx ?? 0;
  const at = o.startedAt ?? new Date();
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
    values (${convId}, ${tid}, ${o.startedBy.id}, ${o.def.name}, ${o.def.name.toLowerCase()}, ${runId})`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flowId}, ${tid}, ${o.startedBy.id}, ${convId}, ${o.def.name}, 1)`;
  const terminal = ["done", "cancelled", "failed", "expired"].includes(status);
  await sql`insert into hub.process_runs ${sql({
    id: runId,
    tenant_id: tid,
    process_def_id: o.def.id,
    def_version: 1,
    snapshot: sql.json({
      key: o.def.key,
      name: o.def.name,
      stages: o.def.stages,
      token_budget: null,
      run_group_ids: [],
    }),
    started_by: o.startedBy.id,
    origin_kind: o.roomId ? "room" : "admin",
    origin_room_id: o.roomId ?? null,
    input: o.input ?? "HD-12 tháng 9",
    conversation_id: convId,
    flow_id: flowId,
    status,
    current_stage_idx: idx,
    decision: o.decision ? sql.json(o.decision) : null,
    expires_at: new Date(at.getTime() + 7 * 86_400_000),
    started_at: at,
    updated_at: at,
    finished_at: terminal ? at : null,
  })}`;
  const stageRunIds: string[] = [];
  for (let i = 0; i < o.def.stages.length; i++) {
    const id = gen();
    stageRunIds.push(id);
    const st =
      i < idx ? "done" : i === idx ? (o.stageStatus ?? STAGE_OF[status] ?? "running") : "pending";
    await sql`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status)
      values (${id}, ${tid}, ${runId}, ${i}, ${st})`;
  }
  return { runId, convId, flowId, stageRunIds };
}

/** `process_outputs` (plan §2.1). */
export async function insertOutput(
  sql: Sql,
  o: {
    tid: string;
    runId: string;
    stageRunId: string;
    stageIdx: number;
    version?: number;
    content?: string;
  },
): Promise<string> {
  const id = gen();
  await sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx, version, attempt,
      content, template_ok)
    values (${id}, ${o.tid}, ${o.runId}, ${o.stageRunId}, ${o.stageIdx}, ${o.version ?? 1}, 1,
      ${o.content ?? "## Bảng ý\nHoá đơn HD-12.\n## Số tiền\n12 000 000"}, true)`;
  // Bất biến plan §3: có output ⇒ stage_runs.current_output_id trỏ bản mới nhất (has_output = current_output_id not null).
  await sql`update hub.stage_runs set current_output_id = ${id} where id = ${o.stageRunId}`;
  return id;
}

/** `review_tasks` + `review_task_assignees` (grant, plan §2.1). */
export async function insertTask(
  sql: Sql,
  o: {
    tid: string;
    runId: string;
    stageRunId: string;
    kind: "review" | "ask" | "decision";
    outputId?: string;
    question?: string;
    reason?: string;
    groupId?: string | null;
    userIds?: string[];
    status?: "open" | "closed";
  },
): Promise<string> {
  const id = gen();
  await sql`insert into hub.review_tasks ${sql({
    id,
    tenant_id: o.tid,
    process_run_id: o.runId,
    stage_run_id: o.stageRunId,
    kind: o.kind,
    status: o.status ?? "open",
    output_id: o.outputId ?? null,
    question: o.kind === "ask" ? (o.question ?? "Kỳ kế toán nào?") : null,
    reason: o.kind === "decision" ? (o.reason ?? "redo_limit") : null,
    assignee_group_id: o.groupId ?? null,
    remind_at: new Date(Date.now() + 86_400_000),
  })}`;
  const rows: Json[] = (o.userIds ?? []).map((u) => ({
    tenant_id: o.tid,
    task_id: id,
    user_id: u,
    via: "initial",
    depth: 0,
  }));
  if (o.groupId)
    rows.push({ tenant_id: o.tid, task_id: id, group_id: o.groupId, via: "initial", depth: 0 });
  for (const r of rows) await sql`insert into hub.review_task_assignees ${sql(r)}`;
  return id;
}

// ---------- tin thread (plan-thread §2–§3): `part` ở parts.ts ----------
/** Một hàng `process_thread_events` (chưa đăng). */
export async function insertEvent(
  sql: Sql,
  o: {
    tid?: string;
    runId: string;
    roomId: string;
    meta: Json;
    content?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const id = gen();
  await sql`insert into hub.process_thread_events (id, tenant_id, process_run_id, room_id, kind, placement, meta, content,
      created_at)
    values (${id}, ${o.tid ?? T.acme}, ${o.runId}, ${o.roomId}, ${o.meta.kind},
      ${o.meta.kind === "block" ? "main" : "flow"}, ${sql.json(o.meta)}, ${o.content ?? `Quy trình · ${o.meta.kind}`},
      ${o.createdAt ?? new Date()})`;
  return id;
}

/** Def `hoa-don-t` của acme (đúng 2 stage) dùng khi chèn run. */
export const DEF_HD = (id: string) => {
  const d = defInput();
  return { id, key: d.key as string, name: d.name as string, stages: d.stages as Json[] };
};
