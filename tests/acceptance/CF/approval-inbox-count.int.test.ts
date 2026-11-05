// CR-121 C-7 · số "Chờ tôi duyệt" cho menu (`PackRunsPort.inboxOf`, MỘT câu SQL) trên hub THẬT: đúng người duyệt thấy số, người
// khác thấy 0, tenant khác không lẫn; `approver` = người có vai duyệt trong quy trình ĐANG GÁN của khe (Group theo mã); khe chưa gán ⇒ false.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import { setSlotDefault } from "../../../apps/hub-api/src/test-support/slot-default";
import {
  type CtxPd,
  DEFS,
  defBody,
  type Json,
  jobDone,
  MD_OK,
  nextStageJob,
  PA,
  PA_FIX,
  startPd,
  T,
  waitStatus,
} from "../P-d/_support/pd";

const KEY = "cr121-c7-inbox";
const REC = "c7000000-0000-4000-8000-000000000001";
const STRANGER = "c7000000-0000-4000-8000-0000000000ff";
const who = (p: { id: string; role: string }, tenantId: string): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});
const A = who(PA.A, T.acme);
const MEMBER = who(PA.B, T.acme); // thành viên Kế toán
const HEAD = who(PA.T, T.acme); // trưởng phòng Kế toán
const ADM = who(PA.Adm, T.acme);
const DB = who(PA.Db, T.beta);

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
const inbox = (u: PackRunCaller) => {
  if (!port.inboxOf) throw new Error("chưa có inboxOf (C-7)");
  return port.inboxOf(u, "contracts", APPROVAL_SLOT);
};

beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  port = bridge.port;
  await c.sql`insert into admin.departments (tenant_id, group_id, head_user_id)
    values (${T.acme}, ${PA_FIX.gKeToan}, ${PA.T.id})
    on conflict (group_id) do update set head_user_id = excluded.head_user_id`;
}, 90_000);
afterAll(async () => {
  if (!c) return;
  await c.sql`delete from admin.departments where group_id = ${PA_FIX.gKeToan}`.catch(() => {});
  await c.stop();
});

describe("CR-121 C-7 · inboxOf (số chờ duyệt + vai duyệt)", () => {
  it("khe chưa gán quy trình ⇒ không ai là người duyệt; chưa có việc ⇒ 0", async () => {
    expect(await inbox(HEAD)).toEqual({ count: 0, approver: false });
    expect(await inbox(MEMBER)).toEqual({ count: 0, approver: false });
  });

  it("đúng người duyệt thấy số, người khác 0, tenant khác không lẫn; vai duyệt theo quy trình đang gán", async () => {
    // Việc: run gói contracts ở bước head_only Kế toán ⇒ chỉ trưởng phòng quyết được.
    const s0 = DEFS.hd.stages[0] as Json;
    const stages: Json[] = [{ ...s0, after: { ...s0.after, head_only: true } }];
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, stages), 1)).toBe("created");
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-C7",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-C7.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    expect((await inbox(HEAD)).count).toBe(1);
    expect((await inbox(MEMBER)).count).toBe(0); // thành viên Group nhưng không phải trưởng phòng
    expect((await inbox(DB)).count).toBe(0); // tenant beta không thấy việc của acme
    expect((await inbox({ userId: STRANGER, tenantId: T.acme, role: "member" })).count).toBe(0);

    // Quy trình đang gán cho khe: 1 bước duyệt Group Kế toán (theo MÃ như def thư viện).
    const [g] = await c.sql<Json[]>`select key from admin.groups where id = ${PA_FIX.gKeToan}`;
    const body = {
      steps: [
        {
          kind: "review",
          key: "kt",
          name: "Kế toán duyệt",
          department_group_id: null,
          department_group_key: g?.key as string,
          head_only: false,
          due_h: 48,
          remind_every_h: null,
          escalate_group_id: null,
          exclude_starter: false,
          when: null,
        },
      ],
    };
    const slotStages = compileSlotStages(body as never);
    const [d] = await c.sql<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
      values (null, 'cr121-c7-slot', 'Duyệt Kế toán', ${JSON.stringify(slotStages)}::text::jsonb, ${APPROVAL_SLOT},
        ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
    const id = d?.id as string;
    await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
      values (${id}, 1, 'Duyệt Kế toán', ${JSON.stringify(slotStages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
    await setSlotDefault(c.sql, T.acme, APPROVAL_SLOT, id);

    expect((await inbox(MEMBER)).approver).toBe(true); // có vai duyệt dù chưa có việc
    expect((await inbox(HEAD)).approver).toBe(true);
    expect((await inbox(DB)).approver).toBe(false); // tenant khác chưa gán khe
    expect((await inbox({ userId: STRANGER, tenantId: T.acme, role: "member" })).approver).toBe(
      false,
    );
  }, 90_000);
});
