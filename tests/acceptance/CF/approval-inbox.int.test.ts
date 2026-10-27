// approval-inbox · trên hub THẬT: bước duyệt HĐ mở ⇒ chuông gói (`hub.notifications`, nguồn `contracts`, link `/contracts/<record_id>`)
// cho MỌI thành viên Group của bước (Kế toán: hoa, cuc) VÀ Group "cũng quyết" `after.also_group_ids` (nhóm chủ: q01, q02); tenant
// khác không có chuông nào; bước được quyết ⇒ chuông "cần duyệt" của bước đánh dấu đã đọc (`notify.resolve_pack_tasks`, 0061).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import {
  type CtxPd,
  DEFS,
  defBody,
  type Json,
  jobDone,
  MD_OK,
  nextStageJob,
  PA,
  PD,
  startPd,
  T,
  waitStatus,
} from "../P-d/_support/pd";

const KEY = "cf-approval-inbox";
const REC = "cf5c0000-0000-4000-8000-000000000001";
const who = (p: { id: string; role: string }, tenantId: string): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});
const A = who(PA.A, T.acme);
const ACTOR = who(PA.T, T.acme); // cuc — thành viên Kế toán
const ADM = who(PA.Adm, T.acme);

const stages = (): Json[] => {
  const s0 = DEFS.hd.stages[0] as Json;
  return [{ ...s0, after: { ...s0.after, also_group_ids: [PD.gG2] } }];
};

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  port = bridge.port;
}, 90_000);
afterAll(async () => {
  if (c) await c.stop();
});

describe("approval-inbox · chuông bước duyệt cho nhóm bước + nhóm chủ", () => {
  it("mở ⇒ đúng người nhận (cả nhóm chủ), tenant khác không thấy; quyết ⇒ đã đọc", async () => {
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, stages()), 1)).toBe("created");
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-03",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-03.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    const open = () => c.sql<Json[]>`select user_id, title, link, read_at from hub.notifications
      where source = 'contracts' and link = ${`/contracts/${REC}`} and kind = 'approval.review_requested'`;
    const got = await open();
    expect(got.map((b) => b.user_id).sort()).toEqual([PA.B.id, PA.T.id, PA.H.id, PA.H2.id].sort());
    expect(got.every((b) => b.read_at === null && String(b.title).startsWith("Cần duyệt:"))).toBe(
      true,
    );
    // tenant khác (beta) không có chuông nào cho HĐ này.
    const beta = await c.sql`select 1 from hub.notifications
      where tenant_id = ${T.beta} and link = ${`/contracts/${REC}`}`;
    expect(beta).toHaveLength(0);

    expect(await port.act(ACTOR, s.runId, { stage: "doc" }, { result: "pass" })).toBe("ok");
    const after = await open();
    expect(after).toHaveLength(4);
    expect(after.every((b) => b.read_at !== null)).toBe(true);
  }, 60_000);
});
