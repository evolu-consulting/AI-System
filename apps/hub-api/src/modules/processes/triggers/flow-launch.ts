// CR-122 · E1 · adapter `FlowLaunch` = engine hiện có (`StartService.createFromApi`, như `PackRunsPort.start`): người bắt đầu = người
// gây sự kiện, run gắn bản ghi app (`pack_key = app`, `pack_record_id = ref` khi ref là uuid) + `flow_event_id`/`company_flow_id`
// cùng tx tạo run (unique ⇒ mở lại cùng sự kiện × flow trả `duplicate`). Lỗi 4xx của engine (def không chạy được, người không được
// chạy…) ⇒ `FlowLaunchRefused` (không thử lại); lỗi khác ⇒ ném (thử lại có lùi).
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError } from "../../../lib/errors";
import { type ProcessDepsCore, StartService } from "../runs/start.service";
import { type FlowLaunch, FlowLaunchRefused } from "./dispatcher";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 23505 (postgres.js `code`, có thể nằm ở `cause` khi drizzle bọc lỗi). */
const isUnique = (e: unknown): boolean =>
  (e as { code?: string })?.code === "23505" ||
  (e as { cause?: { code?: string } })?.cause?.code === "23505";

export function flowLaunchOf(d: ProcessDepsCore): FlowLaunch {
  const start = new StartService(d);
  return async (e, c, app) => {
    const u = { tenantId: e.tenant_id, userId: e.actor_id } as AuthUser;
    try {
      const s = await start.createFromApi(
        u,
        { process_key: c.defKey, input: "", origin: { kind: "none" } },
        {
          flowEvent: { eventRowId: e.id, companyFlowId: c.companyFlowId },
          ...(UUID.test(e.ref) ? { packRef: { pack: app, recordId: e.ref } } : {}),
        },
      );
      return { runId: s.id };
    } catch (err) {
      if (isUnique(err)) return "duplicate";
      if (err instanceof AppError && err.status < 500) throw new FlowLaunchRefused(err.code);
      throw err;
    }
  };
}
