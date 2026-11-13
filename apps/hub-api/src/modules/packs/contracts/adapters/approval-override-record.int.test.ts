// [FIX] Toàn quyền duyệt THAY một bước (có ý kiến + chữ ký) ⇒ «Hồ sơ duyệt» của HĐ phải có đúng 1 mục kèm bằng chứng. Trước đây `engineAct`
// trả về sớm sau `execOrVoid` nên `stage_decided` không được ghi (chỉ có `approval_override`) ⇒ hồ sơ trống. DB thật (pool hub_api, RLS gói);
// engine giả: nhận quyết rồi ghi bằng chứng (owner, như `hub.record_evidence`) và báo id qua `onEvidence`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { ApprovalState } from "../application/approval.ports";
import type { ApprovalEnginePort } from "../application/approval-engine.ports";
import { engineAct } from "../application/approval-engine-card.usecase";
import { approvalRecord } from "../application/approval-record.usecase";
import { approvalEngineRepo } from "./approval-engine.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let CIDS: string[] = [];
let AID = ""; // mỗi ca một lượt + một task mới (index idempotent theo lượt × task × người, không theo HĐ)
let TASK = "";
const RUN = "0a11a000-0000-4000-8000-0000000000e1";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 1411)) as [string];
  [U] = (await users(o, T, 1, { from: 1411 })) as [string];
  CIDS = await contracts(o, T, 3, { from: 1411, createdBy: U, status: "draft" });
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
beforeEach(() => {
  AID = crypto.randomUUID();
  TASK = `t-${crypto.randomUUID()}`;
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const who = () => ({ tenantId: T, userId: U });
const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: {
      markRejected: async () => true,
      markExtracting: async () => true,
      state: async (id: string) => ({ owner: U, approval: { startedBy: U, engineRunId: RUN }, id }),
    },
    approvalEngine: approvalEngineRepo(tx, tid),
    outbox: { enqueue: async () => undefined },
  }));

const task = (override: boolean) => ({
  id: TASK,
  can_act: true,
  ...(override ? { override: true } : {}),
});
/** Engine giả: bước `s0` đang mở; nhận quyết ⇒ (nếu có bằng chứng) ghi `hub.evidence` + báo id. `reply` ≠ ok ⇒ engine từ chối. */
function port(o2: { override: boolean; reply?: "ok" | "not_open" }): ApprovalEnginePort {
  return {
    stepsView: async () => ({
      run_id: RUN,
      status: "waiting_review",
      started_by: U,
      steps: [
        {
          key: "s0",
          status: "open",
          escalated_group_id: null,
          due_at: null,
          escalated: false,
          decided_by: null,
          decided_at: null,
          feedback: null,
          result: null,
          idx: 0,
          name: "Trưởng phòng",
          group_id: null,
          task: task(o2.override),
        },
      ],
    }),
    act: async (_u: unknown, _r: string, _at: unknown, b: Record<string, unknown>) => {
      if (o2.reply === "not_open") return "not_open" as const;
      const ev = b.evidence as { note: string } | undefined;
      const on = b.onEvidence as ((id: string) => void) | undefined;
      if (ev && on) {
        const id = crypto.randomUUID();
        await o.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          await tx`insert into hub.evidence (id, tenant_id, subject_kind, subject_id, note, by_user)
            values (${id}, ${T}, 'task_decision', ${crypto.randomUUID()}, ${ev.note}, ${U})`;
        });
        on(id);
      }
      return "ok" as const;
    },
  } as unknown as ApprovalEnginePort;
}
const state = (): ApprovalState =>
  ({
    runId: AID,
    status: "needs_review",
    hasSource: true,
    version: 1,
    owner: U,
    approval: {
      id: AID,
      status: "level1",
      startedBy: U,
      feedback: null,
      mode: "engine",
      engineRunId: RUN,
      flowSteps: [],
    },
    value: 10,
    deal: "buy",
    threshold: 1000,
  }) as unknown as ApprovalState;
const deps = (p: ApprovalEnginePort): never =>
  ({ port: () => p, uow: uow(), jobs: { enqueue: async () => undefined } }) as never;
const eventsOf = async (cid: string) =>
  (
    await o`select type, data ->> 'evidence_id' as ev, data ->> 'feedback' as fb from contracts.contract_events
      where contract_id = ${cid} and type in ('approval_override', 'stage_decided') order by id`
  ).map((r) => `${r.type}:${r.ev ? "ev" : ""}:${r.fb ?? ""}`);

describe("[FIX] duyệt thay ⇒ hồ sơ duyệt", () => {
  it("Toàn quyền duyệt thay có ý kiến ⇒ ghi override + stage_decided; hồ sơ có 1 mục kèm bằng chứng", async () => {
    const cid = CIDS[0] as string;
    const p = port({ override: true });
    const body = { action: "approve", feedback: "Đồng ý", evidence: { note: "Ý kiến duyệt thay" } };
    expect(await engineAct(deps(p))(who(), cid, body as never, state())).toBe("ok");
    expect(await eventsOf(cid)).toEqual(["approval_override::", "stage_decided:ev:Đồng ý"]);
    const rec = await approvalRecord({
      port: () => p,
      uow: uow(),
      isAdmin: async () => true,
    } as never)(who(), cid);
    expect(rec?.items).toHaveLength(1);
    expect(rec?.items[0]).toMatchObject({
      stage: "s0",
      action: "approve",
      actor: { id: U },
      evidence: { readable: true, note: "Ý kiến duyệt thay", by_user: { id: U } },
    });
  });

  it("bấm lại cùng lượt ⇒ vẫn đúng 1 override + 1 stage_decided (idempotent)", async () => {
    const cid = CIDS[1] as string;
    const p = port({ override: true });
    const act = () => engineAct(deps(p))(who(), cid, { action: "approve" } as never, state());
    await act();
    await act();
    expect(await eventsOf(cid)).toEqual(["approval_override::", "stage_decided::"]);
  });

  it("engine từ chối ⇒ bù trừ: không còn override lẫn stage_decided", async () => {
    const cid = CIDS[2] as string;
    const p = port({ override: true, reply: "not_open" });
    const out = await engineAct(deps(p))(who(), cid, { action: "approve" } as never, state());
    expect(out).toEqual({ error: "APPROVAL_NOT_OPEN" });
    expect(await eventsOf(cid)).toEqual([]);
  });
});
