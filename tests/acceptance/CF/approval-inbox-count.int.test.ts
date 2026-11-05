// CR-121 C-7 Â· sá»‘ "Chá» tÃ´i duyá»‡t" cho menu (`PackRunsPort.inboxOf`, Má»˜T cÃ¢u SQL) trÃªn hub THáº¬T: Ä‘Ãºng ngÆ°á»i duyá»‡t tháº¥y sá»‘, ngÆ°á»i
// khÃ¡c tháº¥y 0, tenant khÃ¡c khÃ´ng láº«n; `approver` = ngÆ°á»i cÃ³ vai duyá»‡t trong quy trÃ¬nh ÄANG GÃN cá»§a khe (Group theo mÃ£); khe chÆ°a gÃ¡n â‡’ false.
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
const MEMBER = who(PA.B, T.acme); // thÃ nh viÃªn Káº¿ toÃ¡n
const HEAD = who(PA.T, T.acme); // trÆ°á»Ÿng phÃ²ng Káº¿ toÃ¡n
const ADM = who(PA.Adm, T.acme);
const DB = who(PA.Db, T.beta);

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
const inbox = (u: PackRunCaller) => {
  if (!port.inboxOf) throw new Error("chÆ°a cÃ³ inboxOf (C-7)");
  return port.inboxOf(u, "contracts", APPROVAL_SLOT);
};

beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chÆ°a gáº¯n PackRunsPort (packRuns bridge)");
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

describe("CR-121 C-7 Â· inboxOf (sá»‘ chá» duyá»‡t + vai duyá»‡t)", () => {
  it("khe chÆ°a gÃ¡n quy trÃ¬nh â‡’ khÃ´ng ai lÃ  ngÆ°á»i duyá»‡t; chÆ°a cÃ³ viá»‡c â‡’ 0", async () => {
    expect(await inbox(HEAD)).toEqual({ count: 0, approver: false });
    expect(await inbox(MEMBER)).toEqual({ count: 0, approver: false });
  });

  it("Ä‘Ãºng ngÆ°á»i duyá»‡t tháº¥y sá»‘, ngÆ°á»i khÃ¡c 0, tenant khÃ¡c khÃ´ng láº«n; vai duyá»‡t theo quy trÃ¬nh Ä‘ang gÃ¡n", async () => {
    // Viá»‡c: run gÃ³i contracts á»Ÿ bÆ°á»›c head_only Káº¿ toÃ¡n â‡’ chá»‰ trÆ°á»Ÿng phÃ²ng quyáº¿t Ä‘Æ°á»£c.
    const s0 = DEFS.hd.stages[0] as Json;
    const stages: Json[] = [{ ...s0, after: { ...s0.after, head_only: true } }];
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, stages), 1)).toBe("created");
    const s = await port.start(A, {
      process_key: KEY,
      input: "HÄ-C7",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## BÃ n giao\nÄÃ£ Ä‘á»c HÄ-C7.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    expect((await inbox(HEAD)).count).toBe(1);
    expect((await inbox(MEMBER)).count).toBe(0); // thÃ nh viÃªn Group nhÆ°ng khÃ´ng pháº£i trÆ°á»Ÿng phÃ²ng
    expect((await inbox(DB)).count).toBe(0); // tenant beta khÃ´ng tháº¥y viá»‡c cá»§a acme
    expect((await inbox({ userId: STRANGER, tenantId: T.acme, role: "member" })).count).toBe(0);

    // Quy trÃ¬nh Ä‘ang gÃ¡n cho khe: 1 bÆ°á»›c duyá»‡t Group Káº¿ toÃ¡n (theo MÃƒ nhÆ° def thÆ° viá»‡n).
    const [g] = await c.sql<Json[]>`select key from admin.groups where id = ${PA_FIX.gKeToan}`;
    const body = {
      steps: [
        {
          kind: "review",
          key: "kt",
          name: "Káº¿ toÃ¡n duyá»‡t",
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
      values (null, 'cr121-c7-slot', 'Duyá»‡t Káº¿ toÃ¡n', ${JSON.stringify(slotStages)}::text::jsonb, ${APPROVAL_SLOT},
        ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
    const id = d?.id as string;
    await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
      values (${id}, 1, 'Duyá»‡t Káº¿ toÃ¡n', ${JSON.stringify(slotStages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
    await setSlotDefault(c.sql, T.acme, APPROVAL_SLOT, id);

    expect((await inbox(MEMBER)).approver).toBe(true); // cÃ³ vai duyá»‡t dÃ¹ chÆ°a cÃ³ viá»‡c
    expect((await inbox(HEAD)).approver).toBe(true);
    expect((await inbox(DB)).approver).toBe(false); // tenant khÃ¡c chÆ°a gÃ¡n khe
    expect((await inbox({ userId: STRANGER, tenantId: T.acme, role: "member" })).approver).toBe(
      false,
    );
  }, 90_000);
});
