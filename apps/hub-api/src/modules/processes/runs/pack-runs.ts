// N2-FR-01 · N2-D04 · N2-D08 · plan N2 §2: cài đặt `PackRunsPort` cho module gói (cùng process, không HTTP nội bộ).
// start = `POST /process-runs` origin none (kiểm def/Group/trần/inputs như route) nhưng hoãn kick; cancel = huỷ của người
// bắt đầu (`GateService.cancel`); outcomes = MỘT câu theo tập trong scope user (RLS + lọc tenant tường minh).
import type { ProcessInputValue } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type {
  PackRunCaller,
  PackRunOutcome,
  PackRunsPort,
} from "../../packs/kit/application/pack-runs.ports";
import type { ProcessDeps } from "../core/ports";
import { GateService } from "../gates/gates.service";
import { packRunsHd3 } from "./pack-runs-hd3";
import { StartService } from "./start.service";

const asUser = (u: PackRunCaller): AuthUser => u as AuthUser;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function packRunsOf(d: ProcessDeps): PackRunsPort {
  const start = new StartService(d);
  const gates = new GateService(d);
  return {
    ...packRunsHd3(d), // HD3 · flow duyệt gói (ensureDef/agent/state/act/outcomesOf/lastApprover)
    async start(u, req) {
      const s = await start.createFromApi(
        asUser(u),
        {
          process_key: req.process_key,
          input: req.input,
          origin: { kind: "none" },
          ...(req.inputs ? { inputs: req.inputs as ProcessInputValue[] } : {}),
        },
        { deferKick: true },
      );
      return { runId: s.id, kick: () => d.launcher.kick(s.id) };
    },
    async cancel(u, runId) {
      await gates.cancel(asUser(u), runId);
    },
    async outcomes(u, runIds) {
      const ids = runIds.filter((x) => UUID.test(x));
      if (ids.length === 0) return [];
      const scope = { kind: "user" as const, userId: u.userId, tenantId: u.tenantId };
      return withHubScope(d.db, scope, async (tx) => {
        const rows = await tx.execute<PackRunOutcome>(sql`select r.id as run_id, r.status,
            (rj.id is not null) as rejected, rj.feedback
          from hub.process_runs r
          left join lateral (select t.id, t.feedback from hub.review_tasks t
            where t.process_run_id = r.id and t.tenant_id = r.tenant_id and t.result = 'reject' limit 1) rj on true
          where r.id = any(${`{${ids.join(",")}}`}::uuid[]) and r.tenant_id = ${u.tenantId}`);
        return [...rows];
      });
    },
  };
}
