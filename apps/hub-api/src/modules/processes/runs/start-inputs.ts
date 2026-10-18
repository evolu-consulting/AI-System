// P-b · PF-S3 · HUB-FR-124 · C19/PB-R18 · validate `inputs` lúc start + dựng `snapshot.sources` (resolve). Tách khỏi
// `start.service.ts`/`runs.repo.ts` cho giới hạn 400 dòng. Scope người bắt đầu (RLS lọc tenant). [HUB-FR-124]

import { TOO_MANY_PROCESS_RUNS_RETRY_AFTER_S } from "@ai/contracts/chat";
import type {
  ProcessInputDef,
  ProcessInputValue,
  SourceConfig,
  SourceKind,
  SourcePin,
} from "@ai/contracts/hub-admin";
import { resolveSteps } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { validationError } from "../../../lib/http";
import type { KhRuntime } from "../../kh/kh.mount";
import { type KhSnapshot, khStartPlan } from "../../kh/kh.start";
import { processError } from "../core/errors";
import { expiresAt } from "../domain/defs/ttl.rules";
import { isCalendarDate, isNumberText, shapeValid } from "../domain/runs/start-inputs.rules";
import type { StartDefRow } from "./runs.repo";
import * as repo from "./runs.repo";
import { allowlistUnion } from "./sources.rules";

export type RunOrigin = {
  originKind: "room" | "conversation" | "admin";
  originRoomId: string | null;
  originConversationId: string | null;
};

/**
 * HUB-FR-105/HUB-FR-124 · tạo run: validate inputs (C19) + dựng `snapshot.sources` + chiếm slot (≤ 5/tenant) + `insertRun`.
 * `pinned_sources` = NULL khi có nguồn (chờ resolve), `[]` khi không (ghim ngay). Trong tx scope người bắt đầu.
 */
export async function createRun(
  tx: Tx,
  u: AuthUser,
  p: { def: StartDefRow; input: string; origin: RunOrigin; inputs?: ProcessInputValue[] },
  cfg: { runsPerTenant: number; now: () => Date; kh?: KhRuntime },
): Promise<{ runId: string; flowId: string }> {
  const inputs = p.inputs ?? [];
  await validateRunInputs(tx, u, p.def.inputs ?? [], inputs);
  const sources = await buildRunSources(tx, u, p.def, inputs);
  const khPlan = await khStartPlan(tx, p.def.stages, cfg.kh); // K1 · đích `## Tóm tắt` (HUB-FR-133)
  await repo.lockTenant(tx, u.tenantId);
  if ((await repo.countActive(tx, u.tenantId)) >= cfg.runsPerTenant)
    throw processError("TOO_MANY_PROCESS_RUNS", undefined, {
      "Retry-After": String(TOO_MANY_PROCESS_RUNS_RETRY_AFTER_S),
    });
  const startedAt = cfg.now();
  const runId = crypto.randomUUID();
  const flowId = crypto.randomUUID();
  await insertRun(tx, {
    id: runId,
    tenantId: u.tenantId,
    convId: crypto.randomUUID(),
    flowId,
    def: p.def,
    startedBy: u.userId,
    input: p.input,
    expiresAt: expiresAt(startedAt, p.def.ttl_days),
    startedAt,
    sources,
    inputs,
    pinnedSources: sources.length > 0 ? null : [],
    stages: khPlan.stages,
    kh: khPlan.kh,
    ...p.origin,
  });
  return { runId, flowId };
}

/** Nguồn chốt vào `snapshot.sources` (song song `pinned_sources`). */
export type SnapshotSource = {
  source_id: string;
  key: string;
  kind: SourceKind;
  config: SourceConfig;
  description: string;
  allowlist_union: string[];
};

export type NewRun = {
  id: string;
  tenantId: string;
  convId: string;
  flowId: string;
  def: StartDefRow;
  startedBy: string;
  originKind: "room" | "conversation" | "admin";
  originRoomId: string | null;
  originConversationId: string | null;
  input: string;
  /** PD-R25 · `expires_at = startedAt + ttl_days`; null ⇒ không hết hạn. */
  expiresAt: Date | null;
  startedAt: Date;
  /** P-b · nguồn def-level (resolve); rỗng ⇒ không nguồn. */
  sources: SnapshotSource[];
  /** P-b · đầu vào run. */
  inputs: ProcessInputValue[];
  /** P-b · null = chờ resolve; [] = def không nguồn (ghim ngay). */
  pinnedSources: SourcePin[] | null;
  /** K1 · stage của snapshot (đã `ensureSummary`); vắng ⇒ `def.stages`. */
  stages?: unknown[];
  /** K1 · `snapshot.kh` (đích `## Tóm tắt`); null/vắng ⇒ không có khoá `kh`. */
  kh?: KhSnapshot | null;
};

/** Tạo hội thoại nền + flow (= thread) + `process_runs` + `stage_runs` (P-b2 §3.1: stage BƯỚC 0 queued ≤ 3, còn lại
 * pending ≤ 10; `current_step` = 0 mặc định cột). */
export async function insertRun(tx: Tx, n: NewRun): Promise<void> {
  const name = n.def.name;
  await tx.execute(sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
    values (${n.convId}, ${n.tenantId}, ${n.startedBy}, ${name}, ${name.toLowerCase()}, ${n.id})`);
  await tx.execute(sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
    values (${n.flowId}, ${n.tenantId}, ${n.startedBy}, ${n.convId}, ${name})`);
  const stages = n.stages ?? n.def.stages;
  const snapshot = {
    key: n.def.key,
    name: n.def.name,
    stages,
    token_budget: n.def.token_budget,
    ttl_days: n.def.ttl_days,
    run_group_ids: n.def.run_group_ids,
    sources: n.sources,
    ...(n.kh ? { kh: n.kh } : {}),
  };
  const pinned =
    n.pinnedSources === null ? sql`null` : sql`${JSON.stringify(n.pinnedSources)}::jsonb`;
  await tx.execute(sql`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by,
      origin_kind, origin_room_id, origin_conversation_id, input, conversation_id, flow_id, started_at, expires_at,
      pinned_sources, sources_pinned_at, inputs)
    values (${n.id}, ${n.tenantId}, ${n.def.id}, ${n.def.version}, ${JSON.stringify(snapshot)}::jsonb, ${n.startedBy},
      ${n.originKind}, ${n.originRoomId}, ${n.originConversationId}, ${n.input}, ${n.convId}, ${n.flowId},
      ${n.startedAt.toISOString()}::timestamptz, ${n.expiresAt?.toISOString() ?? null}::timestamptz, ${pinned},
      ${n.pinnedSources === null ? sql`null` : sql`now()`}, ${JSON.stringify(n.inputs)}::jsonb)`);
  const steps = resolveSteps(stages as readonly { step?: number }[]);
  const rows = sql.join(
    steps.map((st, i) => sql`(${n.tenantId}, ${n.id}, ${i}, ${st === 0 ? "queued" : "pending"})`),
    sql`, `,
  );
  await tx.execute(
    sql`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status) values ${rows}`,
  );
}

type ResolvedSourceRow = {
  id: string;
  key: string;
  kind: SourceKind;
  config: SourceConfig;
  description: string;
};

async function sourcesByKeys(
  tx: Tx,
  tenantId: string,
  keys: readonly string[],
): Promise<ResolvedSourceRow[]> {
  if (keys.length === 0) return [];
  return tx.execute<ResolvedSourceRow>(sql`select id, key, kind, config, description
    from hub.sources where tenant_id = ${tenantId} and deleted_at is null
      and key in (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )})`);
}

async function sourceByKey(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<ResolvedSourceRow | null> {
  const [r] = await tx.execute<ResolvedSourceRow>(sql`select id, key, kind, config, description
    from hub.sources where tenant_id = ${tenantId} and key = ${key} and deleted_at is null`);
  return r ?? null;
}

/**
 * PB-R18 · attachment `upload` thuộc đúng người bắt đầu + tenant (file input hợp lệ). X2b2 S8 · file đã gắn tin phòng
 * (`room_id` ≠ NULL) KHÔNG làm input quy trình (R06: file phòng chỉ ở phòng).
 */
async function ownsUpload(
  tx: Tx,
  tenantId: string,
  userId: string,
  attId: string,
): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.attachments
    where id = ${attId} and tenant_id = ${tenantId} and user_id = ${userId} and purged_at is null
      and room_id is null limit 1`);
  return r !== undefined;
}

const badInput = () =>
  validationError([{ path: ["inputs"], code: "custom", message: "invalid input" }]);

/** PD-R13 · `date`: `YYYY-MM-DD` + ngày lịch có thật; D2-44 · `number`: số hữu hạn sau khi cắt khoảng trắng — sai ⇒ 400
 * path `inputs.<i>.value`. Hợp lệ / kiểu khác ⇒ null. */
function valueIssue(v: ProcessInputValue): string | null {
  if (v.type === "date" && !isCalendarDate(v.value)) return "invalid date";
  if (v.type === "number" && !isNumberText(v.value)) return "invalid number";
  return null;
}

/** C19 · key∈def.inputs, type khớp, select∈options, source_ref=git_remote cùng tenant, file thuộc người bắt đầu. */
export async function validateRunInputs(
  tx: Tx,
  u: AuthUser,
  defInputs: ProcessInputDef[],
  inputs: ProcessInputValue[],
): Promise<void> {
  const byKey = new Map(defInputs.map((d) => [d.key, d]));
  for (const [i, v] of inputs.entries()) {
    if (!shapeValid(byKey.get(v.key), v)) throw badInput();
    const bad = valueIssue(v);
    if (bad)
      throw validationError([{ path: ["inputs", i, "value"], code: "custom", message: bad }]);
    if (v.type === "source_ref") {
      const row = await sourceByKey(tx, u.tenantId, v.source_key);
      if (row?.kind !== "git_remote") throw badInput();
    } else if (v.type === "file" && !(await ownsUpload(tx, u.tenantId, u.userId, v.attachment_id)))
      throw badInput();
  }
}

/** `snapshot.sources` (def-level, union allowlist các stage) + áp branch của source_ref (git_remote). */
export async function buildRunSources(
  tx: Tx,
  u: AuthUser,
  def: StartDefRow,
  inputs: ProcessInputValue[],
): Promise<SnapshotSource[]> {
  const keys = def.sources ?? [];
  if (keys.length === 0) return [];
  const rows = await sourcesByKeys(tx, u.tenantId, keys);
  const byKey = new Map(rows.map((r) => [r.key, r] as const));
  const branchByKey = new Map<string, string>();
  for (const v of inputs) if (v.type === "source_ref") branchByKey.set(v.source_key, v.branch);
  const stages = def.stages as { sources?: { source_key: string; allowlist?: string[] }[] }[];
  const out: SnapshotSource[] = [];
  for (const key of keys) {
    const row = byKey.get(key);
    if (!row) continue;
    let config = row.config;
    const branch = branchByKey.get(key);
    if (branch && config.kind === "git_remote") config = { ...config, branch };
    out.push({
      source_id: row.id,
      key: row.key,
      kind: row.kind,
      config,
      description: row.description,
      allowlist_union: allowlistUnion(stages, key),
    });
  }
  return out;
}
