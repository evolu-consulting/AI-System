// CR-120 · G4 · `PackRunsPort.signalEvent`: gói bắn sự kiện cho run gắn bản ghi gói của mình. Tìm run CHƯA kết thúc của
// (tenant, pack, record) bằng MỘT câu scope system lọc `tenant_id` tường minh, rồi mỗi run MỘT tx `system(tenantId)` chạy use case
// `signalEvent` (khoá run → stage → timer). Lỗi một run ⇒ ném (gói ghi log, không chặn việc của gói). Khoá sự kiện sai dạng ⇒ 0.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackRunRef } from "../../packs/kit/public";
import type { SystemUow } from "../application/ports";
import { signalEvent } from "../application/timers/signal-event.usecase";
import type { ProcessDeps } from "../core/ports";
import { cleanEventData, type EventData } from "../domain/timers/wait-event-data.rules";
import { UUID } from "./pack-runs-view";

export { packRecordPort } from "./pack-run-record"; // cr125-contract-from-step

const PACK_KEY = /^[a-z][a-z0-9-]{0,39}$/;
/** = `WAIT_EVENT_KEY_RE` của contract. */
export const EVENT_KEY = /^[a-z][a-z0-9_.-]{1,63}$/;

export async function signalPackEvent(
  d: ProcessDeps,
  sys: Pick<SystemUow, "system"> | undefined,
  x: { tenantId: string; ref: PackRunRef; event: string; data?: EventData },
): Promise<number> {
  const { tenantId, ref, event } = x;
  // CR-125 m9 · lọc một lần (khoá/giá trị sai bị bỏ) — use case chỉ ghi khi sự kiện thả đúng stage chờ.
  const data = x.data ? cleanEventData(x.data) : undefined;
  if (!UUID.test(tenantId) || !UUID.test(ref.record_id) || !PACK_KEY.test(ref.pack)) return 0;
  if (!EVENT_KEY.test(event)) return 0;
  if (!sys) throw new Error("PackRunsPort.signalEvent: chưa nối cổng system");
  const runs = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ id: string }>(sql`select id from hub.process_runs
      where tenant_id = ${tenantId} and pack_key = ${ref.pack} and pack_record_id = ${ref.record_id}
        and status not in ('done', 'cancelled', 'failed', 'expired')`),
  );
  let released = 0;
  for (const r of runs) {
    const out = await sys.system(tenantId, (repos) =>
      signalEvent(repos, { runId: r.id, event, now: d.now(), ...(data ? { data } : {}) }),
    );
    if (out.kind === "ok") released += out.released;
  }
  return released;
}
