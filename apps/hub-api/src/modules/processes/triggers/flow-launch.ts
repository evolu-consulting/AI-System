// CR-122 · E1/E1b · adapter `FlowLaunch` = engine hiện có (`StartService.createFromApi`, như `PackRunsPort.start`): người bắt đầu =
// người gây sự kiện, run gắn bản ghi app (`pack_key = app`, `pack_record_id = ref` khi ref là uuid) + `flow_event_id`/`company_flow_id`
// cùng tx tạo run (unique `process_runs_flow_event_uq` ⇒ mở lại cùng sự kiện × flow trả `duplicate`).
// E1b · flow Thư viện được gán (`defTenantId` null) chạy THẲNG bản xuất bản mới nhất: đọc def + Group theo mã (scope system, 2 câu),
// đổi mã → id công ty; thiếu ⇒ `FlowLaunchRefused`. Lỗi 4xx của engine ⇒ `FlowLaunchRefused` (không thử lại); lỗi khác ⇒ ném.
import { eventOf, recordInputsOf } from "@ai/contracts/app-manifest";
import { packGroupKey } from "@ai/contracts/packs";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { linkRunFiles } from "../../attachments/public";
import { surfaceOf } from "../../packs/kit/public";
import { outcomeHandlerFor } from "../adapters/runs/flow-ports";
import { nodeFeatureMiss } from "../defs/node-features";
import { type FlowEventAttach, FlowRunSuperseded } from "../runs/flow-event-attach";
import { libraryFlowDef, type StartDefRow } from "../runs/runs.repo";
import { type ProcessDepsCore, StartService } from "../runs/start.service";
import { type FlowLaunch, FlowLaunchRefused } from "./dispatcher";
import type { CandidateRow, ClaimedEvent } from "./dispatcher.repo";
import { bindGroupKeys, groupKeysOf } from "./group-keys.rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLOW_EVENT_UQ = "process_runs_flow_event_uq";

/** 23505 của ĐÚNG unique sự kiện × flow (postgres.js `constraint_name`, có thể nằm ở `cause` khi drizzle bọc). Unique khác ⇒ lỗi thật. */
export const isFlowEventDup = (e: unknown): boolean => {
  const x = e as { code?: string; constraint_name?: string; cause?: unknown };
  const c = (x?.cause ?? {}) as { code?: string; constraint_name?: string };
  return (
    (x?.code === "23505" && x.constraint_name === FLOW_EVENT_UQ) ||
    (c.code === "23505" && c.constraint_name === FLOW_EVENT_UQ)
  );
};

async function libraryDefFor(
  d: ProcessDepsCore,
  e: ClaimedEvent,
  c: CandidateRow,
): Promise<StartDefRow> {
  const out = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const def = await libraryFlowDef(tx, c.flowId);
    if (!def) return null;
    const keys = groupKeysOf(def.stages);
    const rows =
      keys.length === 0
        ? []
        : await tx.execute<{ id: string; key: string }>(sql`select id, key from admin.groups
            where tenant_id = ${e.tenant_id}::uuid and key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`);
    return { def, ids: new Map(rows.map((r) => [r.key, r.id])) };
  });
  if (!out) throw new FlowLaunchRefused("library_not_published");
  const b = bindGroupKeys(out.def.stages, out.ids);
  if (b.missing.length > 0) throw new FlowLaunchRefused(`group_missing:${b.missing.join(",")}`);
  return { ...out.def, stages: b.stages };
}

/** CR-113 · cr125-fix-owner-override · Group Toàn quyền của app (`<app>-owner`) CÙNG tenant của sự kiện — quyết thay mọi bước duyệt
 *  (`withOwnerOverride` lúc tạo run, cùng luật đường khe). Không có Group ⇒ rỗng. */
async function ownerGroupIdsOf(d: ProcessDepsCore, tenantId: string, app: string) {
  const key = packGroupKey(surfaceOf(app)?.pack ?? app, "owner"); // ADR-0044: mặt Bảng tin dùng nhóm chủ gói contracts
  const rows = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ id: string }>(sql`select id::text as id from admin.groups
      where tenant_id = ${tenantId}::uuid and key = ${key}`),
  );
  return [...rows].map((r) => r.id);
}

/** CR-122 · P11 · app gắn run vào bản ghi CÙNG tx tạo run (vd thẻ duyệt HĐ ⇒ `mode engine` + `engine_run_id`, CAS). */
function onCreatedOf(e: ClaimedEvent, app: string) {
  const h = outcomeHandlerFor(app, e.event);
  if (!h?.launched || !UUID.test(e.ref)) return undefined;
  const launched = h.launched.bind(h);
  return (tx: Tx, runId: string) =>
    launched(tx, { tenantId: e.tenant_id, runId, event: e.event, ref: e.ref });
}

/** CR-125 · cr125-run-attachments · sau `onCreated` của app (false = thua CAS ⇒ không liên kết), liên kết tệp phiếu vào lượt mới. */
function withStartFiles(
  base: ((tx: Tx, runId: string) => Promise<unknown>) | undefined,
  e: ClaimedEvent,
  fileIds: readonly string[],
): ((tx: Tx, runId: string) => Promise<unknown>) | undefined {
  if (fileIds.length === 0 || !e.actor_id) return base;
  const userId = e.actor_id;
  return async (tx, runId) => {
    const r = await base?.(tx, runId);
    if (r === false) return false;
    await linkRunFiles(tx, { tenantId: e.tenant_id, userId, runId, ids: fileIds, source: "start" });
    return r;
  };
}

/** CR-125 · bắt đầu bằng phiếu (`processes/start`): giá trị phiếu ⇒ input của lượt (cùng đường mở lượt với sự kiện). */
export type LaunchExtra = {
  inputs?: FlowEventAttach["recordInputs"];
  /** CR-125 · id tệp (ô «Tệp đính kèm») liên kết vào lượt CÙNG tx tạo lượt; chỉ tệp `upload` của người bắt đầu được nhận. */
  fileIds?: readonly string[];
};

function launchOpts(
  e: ClaimedEvent,
  c: CandidateRow,
  app: string,
  def: StartDefRow | undefined,
  ownerGroupIds: string[],
  x?: LaunchExtra,
) {
  // CR-122 · A · input của lượt = bản ghi (`record` = ref) + dữ kiện lúc sự kiện ⇒ node/tool cần `contract_id` tự nhận.
  const recordInputs = [
    ...recordInputsOf(eventOf(app, e.event), e.ref, e.facts ?? {}),
    ...(x?.inputs ?? []),
  ];
  const onCreated = withStartFiles(onCreatedOf(e, app), e, x?.fileIds ?? []);
  return {
    flowEvent: {
      eventRowId: e.id,
      event: e.event, // P11g · snapshot.trigger.event ⇒ node Nếu đọc được dữ kiện app
      companyFlowId: c.companyFlowId,
      recordInputs,
      ownerGroupIds,
      ...(def ? { def } : {}),
      ...(onCreated ? { onCreated } : {}),
    },
    ...(UUID.test(e.ref) ? { packRef: { pack: app, recordId: e.ref } } : {}),
  };
}

/**
 * Node thiếu tính năng — kiểm theo cache; thấy thiếu ⇒ nạp lại cấu hình MỘT lần rồi kiểm lại. Từ chối là kết cục cuối (không thử
 * lại): cache cũ (tính năng vừa bật cùng lúc gán flow, NOTIFY/poll chưa tới) làm HĐ đầu tiên mất lượt mãi mãi.
 */
async function featureMissFresh(d: ProcessDepsCore, tenantId: string, nodes: readonly string[]) {
  const miss = await nodeFeatureMiss(d.config, tenantId, nodes);
  if (!miss) return null;
  await d.config.poll?.();
  return nodeFeatureMiss(d.config, tenantId, nodes);
}

export type FlowLaunchX = (
  e: ClaimedEvent,
  c: CandidateRow,
  app: string,
  x?: LaunchExtra,
) => ReturnType<FlowLaunch>;

export function flowLaunchOf(d: ProcessDepsCore): FlowLaunchX {
  const start = new StartService(d);
  return async (e, c, app, x) => {
    if (!e.actor_id) throw new FlowLaunchRefused("no_actor");
    const off = await featureMissFresh(d, e.tenant_id, c.nodes);
    if (off) throw new FlowLaunchRefused(`FLOW_NODE_FEATURE_OFF:${off.node}`);
    const u = { tenantId: e.tenant_id, userId: e.actor_id } as AuthUser;
    const [def, owners] = await Promise.all([
      c.defTenantId === null ? libraryDefFor(d, e, c) : undefined,
      ownerGroupIdsOf(d, e.tenant_id, app),
    ]);
    try {
      const s = await start.createFromApi(
        u,
        { process_key: c.defKey, input: "", origin: { kind: "none" } },
        launchOpts(e, c, app, def, owners, x),
      );
      return { runId: s.id };
    } catch (err) {
      return launchFailure(err);
    }
  };
}

/** Lỗi tạo run ⇒ kết quả: trùng sự kiện × flow ⇒ `duplicate`; app không nhận lượt (P11c, tx đã rollback) ⇒ `superseded` (chốt, không
 *  thử lại); 4xx engine ⇒ từ chối; còn lại ⇒ ném (thử lại). */
function launchFailure(err: unknown): "duplicate" | "superseded" {
  if (isFlowEventDup(err)) return "duplicate";
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (err instanceof FlowRunSuperseded || cause instanceof FlowRunSuperseded) return "superseded";
  if (err instanceof AppError && err.status < 500) throw new FlowLaunchRefused(err.code);
  throw err;
}
