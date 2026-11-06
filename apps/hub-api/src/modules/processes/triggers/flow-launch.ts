// CR-122 · E1/E1b · adapter `FlowLaunch` = engine hiện có (`StartService.createFromApi`, như `PackRunsPort.start`): người bắt đầu =
// người gây sự kiện, run gắn bản ghi app (`pack_key = app`, `pack_record_id = ref` khi ref là uuid) + `flow_event_id`/`company_flow_id`
// cùng tx tạo run (unique `process_runs_flow_event_uq` ⇒ mở lại cùng sự kiện × flow trả `duplicate`).
// E1b · flow Thư viện được gán (`defTenantId` null) chạy THẲNG bản xuất bản mới nhất: đọc def + Group theo mã (scope system, 2 câu),
// đổi mã → id công ty; thiếu ⇒ `FlowLaunchRefused`. Lỗi 4xx của engine ⇒ `FlowLaunchRefused` (không thử lại); lỗi khác ⇒ ném.
import { eventOf, recordInputsOf } from "@ai/contracts/app-manifest";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { outcomeHandlerFor } from "../adapters/runs/flow-ports";
import { nodeFeatureMiss } from "../defs/node-features";
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

/** CR-122 · P11 · app gắn run vào bản ghi CÙNG tx tạo run (vd thẻ duyệt HĐ ⇒ `mode engine` + `engine_run_id`, CAS). */
function onCreatedOf(e: ClaimedEvent, app: string) {
  const h = outcomeHandlerFor(app, e.event);
  if (!h?.launched || !UUID.test(e.ref)) return undefined;
  const launched = h.launched.bind(h);
  return (tx: Tx, runId: string) =>
    launched(tx, { tenantId: e.tenant_id, runId, event: e.event, ref: e.ref });
}

function launchOpts(e: ClaimedEvent, c: CandidateRow, app: string, def: StartDefRow | undefined) {
  // CR-122 · A · input của lượt = bản ghi (`record` = ref) + dữ kiện lúc sự kiện ⇒ node/tool cần `contract_id` tự nhận.
  const recordInputs = recordInputsOf(eventOf(app, e.event), e.ref, e.facts ?? {});
  const onCreated = onCreatedOf(e, app);
  return {
    flowEvent: {
      eventRowId: e.id,
      companyFlowId: c.companyFlowId,
      recordInputs,
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

export function flowLaunchOf(d: ProcessDepsCore): FlowLaunch {
  const start = new StartService(d);
  return async (e, c, app) => {
    if (!e.actor_id) throw new FlowLaunchRefused("no_actor");
    const off = await featureMissFresh(d, e.tenant_id, c.nodes);
    if (off) throw new FlowLaunchRefused(`FLOW_NODE_FEATURE_OFF:${off.node}`);
    const u = { tenantId: e.tenant_id, userId: e.actor_id } as AuthUser;
    const def = c.defTenantId === null ? await libraryDefFor(d, e, c) : undefined;
    try {
      const s = await start.createFromApi(
        u,
        { process_key: c.defKey, input: "", origin: { kind: "none" } },
        launchOpts(e, c, app, def),
      );
      return { runId: s.id };
    } catch (err) {
      if (isFlowEventDup(err)) return "duplicate";
      if (err instanceof AppError && err.status < 500) throw new FlowLaunchRefused(err.code);
      throw err;
    }
  };
}
