// CR-121 D-1 · dữ kiện HIỆN TẠI cho rẽ duyệt HĐ trên DB thật (pool hub_api; tx gói role `contracts_rw` + RLS; phòng ban scope system):
// tool `contracts-route` thật (repo thật) rẽ theo giá trị SAU khi sửa, phòng con của "sales", đối tác mới; chặn đọc chéo tenant ở cả hai
// nguồn; trần 20 bước: def 22 stage lưu qua `ensureDef` thật + run/stage ở bước cuối (21) qua CHECK đã nới (migration 0097).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PROCESS_STAGES_CEILING } from "@ai/contracts/chat";
import { contracts, groups, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { packRunsPortForTest } from "../../../../test-support/pack-runs-port";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackToolCatalog } from "../../kit/application/pack-tools.ports";
import { callerOf, routeStep } from "../application/approval-engine.usecase";
import { APPROVAL_PROCESS_KEY, compileDef } from "../domain/approval-flow.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { approvalEngineRepo } from "./approval-engine.repo";
import { approvalEngineTools } from "./approval-engine.tools";
import { creatorDepartmentsOf, flowFactsRepo } from "./flow-facts.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let A = ""; // phòng "sales-hn" (con của "sales")
let B = ""; // phòng "ops"
let X = ""; // tenant T2, cũng ở phòng "sales" của T2
let g = new Map<string, string>();
let ids: string[] = [];
let other = "";
const runs: string[] = [];

const review = (key: string, when: unknown = null): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: g.get("sales") as string,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when,
  }) as FlowStep;
const when = (c: unknown) => ({ op: "and", conds: [c] });
/** Lưới an toàn (Luật 4c): một bước treo ⇒ fail NGAY kèm tên bước, không để `bun test` hết giờ (bun 1.3 treo 100 % CPU sau timeout). */
function step<T>(label: string, p: Promise<T>, ms = 8_000): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`bước "${label}" không xong sau ${ms} ms`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(t));
}

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approvalEngine: approvalEngineRepo(tx, tid),
    approvalFlow: {} as never,
    flowFacts: flowFactsRepo(tx, tid),
  }));
const route = (i: number, user: string, from = 0) =>
  routeStep({ uow: uow(), groups: { creatorDepartments: creatorDepartmentsOf(db) } })(
    { tenantId: T, userId: user, processRunId: runs[i] as string },
    { contract_id: ids[i], from_step: from },
  );

/** HĐ `i`: lượt engine `level1` gắn run riêng, mẫu chụp `steps`, giá trị + bên bán. */
async function seed(i: number, steps: FlowStep[], value: number, supplier: string | null) {
  const id = ids[i] as string;
  const aid = crypto.randomUUID();
  runs[i] = crypto.randomUUID();
  await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, engine_run_id, flow_steps)
    values (${aid}, ${T}, ${id}, 'level1', ${A}, 'engine', ${runs[i] as string}, ${o.json(steps as never)})`;
  await setFields(i, value, supplier);
  await o`update contracts.contracts set status = 'needs_review', run_id = ${aid}, deal = 'buy', direction = 'purchase' where id = ${id}`;
}
const setFields = (i: number, value: number, supplier: string | null) =>
  o`update contracts.contracts set fields = jsonb_build_object('total_value', jsonb_build_object('value', ${value}::bigint))
    || case when ${supplier}::text is null then '{}'::jsonb
       else jsonb_build_object('supplier_name', jsonb_build_object('value', ${supplier}::text)) end
    where id = ${ids[i] as string}`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 1211)) as [string, string];
  [A, B] = (await users(o, T, 2, { from: 1211 })) as [string, string];
  [X] = (await users(o, T2, 1, { from: 1213 })) as [string];
  g = await groups(o, T, ["sales", "sales-hn", "ops"]);
  const g2 = await groups(o, T2, ["sales"]);
  const k = (key: string) => g.get(key) as string;
  await o`insert into admin.departments (tenant_id, group_id, parent_group_id) values
    (${T}, ${k("sales")}, null), (${T}, ${k("sales-hn")}, ${k("sales")}), (${T}, ${k("ops")}, null),
    (${T2}, ${g2.get("sales") as string}, null)`;
  await members(o, T, k("sales-hn"), [A]);
  await members(o, T, k("ops"), [B]);
  await members(o, T2, g2.get("sales") as string, [X]);
  ids = await contracts(o, T, 5, { from: 1211, createdBy: A, status: "needs_review" });
  [other] = (await contracts(o, T2, 1, { from: 1216, createdBy: X, status: "active" })) as [string];
}, 120_000);
afterAll(async () => {
  // Dọn lượt duyệt đã chèn: DB worker dùng chung với `migrate-hub.int` (reset chỉ xoá admin/hub, giữ `contracts`) — admin 0026
  // đọc `contracts.approvals` ⇒ hàng sót trỏ tenant đã xoá làm hỏng FK.
  if (o && T) {
    const ts = o.array([T, T2]);
    await o`update contracts.contracts set run_id = null where tenant_id = any(${ts}::uuid[]) and run_id is not null`;
    await o`delete from contracts.approvals where tenant_id = any(${ts}::uuid[])`;
  }
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 D-1 · contracts-route theo giá trị HIỆN TẠI (DB thật)", () => {
  it("600 tr ⇒ qua bước ≥ 500 tr; sửa còn 100 tr giữa lượt ⇒ lần rẽ sau bỏ qua", async () => {
    await seed(
      0,
      [review("l1"), review("gd", when({ field: "total_value", op: "ge", value: 500_000_000 }))],
      600_000_000,
      null,
    );
    expect(await route(0, A)).toEqual({ next: 2 });
    await setFields(0, 100_000_000, null);
    expect(await route(0, A)).toEqual({ next: 3 });
  });

  it("người bắt đầu thuộc phòng con của sales ⇒ `creator_department in [sales]` đúng; phòng khác ⇒ bỏ qua", async () => {
    await seed(
      1,
      [review("l1"), review("kd", when({ field: "creator_department", in: ["sales"] }))],
      1,
      null,
    );
    expect(await route(1, A)).toEqual({ next: 2 });
    expect(await route(1, B)).toEqual({ next: 3 });
    expect(await creatorDepartmentsOf(db)(T, A)).toEqual(["sales", "sales-hn"]);
  });

  it("đối tác mới: chưa gắn ⇒ bước chạy; có đối tác chưa từng duyệt ⇒ chạy; đã có HĐ duyệt cùng đối tác ⇒ bỏ qua", async () => {
    await seed(2, [review("l1"), review("moi", when({ field: "new_partner", is: true }))], 1, null);
    expect(await route(2, A)).toEqual({ next: 2 }); // chưa có dữ liệu
    await setFields(2, 1, "Cong ty Doi Tac Moi");
    expect(await route(2, A)).toEqual({ next: 2 });
    // HĐ cùng đối tác ở tenant KHÁC đã duyệt ⇒ không tính (lọc tenant).
    await o`update contracts.contracts set fields = jsonb_build_object('supplier_name', jsonb_build_object('value', 'Cong ty Doi Tac Moi')),
      confirmed_at = now() where id = ${other}`;
    expect(await route(2, A)).toEqual({ next: 2 });
    await o`update contracts.contracts set fields = jsonb_build_object('supplier_name', jsonb_build_object('value', 'Cong ty Doi Tac Moi')),
      confirmed_at = now() where id = ${ids[3] as string}`;
    expect(await route(2, A)).toEqual({ next: 3 });
  });
});

describe("CR-121 D-1 · chặn đọc chéo tenant (đường đọc dữ kiện)", () => {
  it("phòng ban: user tenant khác ⇒ []; đối tác mới: HĐ tenant khác dưới tx tenant này ⇒ không thấy (null)", async () => {
    expect(await creatorDepartmentsOf(db)(T, X)).toEqual([]);
    expect(await creatorDepartmentsOf(db)(T2, A)).toEqual([]);
    const seen = await uow().tenant({ tenantId: T2, userId: X }, (r) =>
      r.flowFacts.newPartner(ids[2] as string),
    );
    expect(seen).toBeNull();
  });
});

describe("CR-121 D-1 · trần 20 bước (migration 0097)", () => {
  it("def 20 bước (22 stage) lưu qua ensureDef thật; rẽ tới bước 20 rồi finalize; run/stage ở stage cuối qua CHECK", async () => {
    const steps = Array.from({ length: 20 }, (_, i) =>
      review(`b${i}`, i === 0 ? null : when({ field: "total_value", op: "ge", value: 1 })),
    );
    const def = compileDef({ steps }, new Set([g.get("sales") as string]));
    expect(def.stages).toHaveLength(22);
    const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
      key: t.name,
      name: t.name,
      description: t.description,
      sideEffect: false,
      action: t.action,
      params: t.params,
    }));
    const catalog = {
      has: (k: string) => tools.some((t) => t.key === k),
      info: (k: string) => tools.find((t) => t.key === k),
      enabled: async () => true,
      available: async (_t: string, keys?: readonly string[]) =>
        tools.filter((t) => !keys || keys.includes(t.key)),
    } as unknown as PackToolCatalog;
    const port = packRunsPortForTest(db, catalog);
    await step(
      "ensureDef",
      port.ensureDef(callerOf({ tenantId: T, userId: A }), APPROVAL_PROCESS_KEY, def as never, 1),
    );
    const [d] = await step(
      "def",
      o<{ id: string; n: number }[]>`select id::text as id, jsonb_array_length(stages) as n
        from hub.process_defs where tenant_id = ${T} and key = ${APPROVAL_PROCESS_KEY} and deleted_at is null`,
    );
    expect(d?.n).toBe(22);
    // Rẽ trên mẫu chụp 20 bước: bước 18 ⇒ stage bước 19 (engine 20); bước 19 ⇒ finalize (engine 21).
    await step("seed", seed(4, steps, 5, null));
    expect(await step("route18", route(4, A, 18))).toEqual({ next: 20 });
    expect(await step("route19", route(4, A, 19))).toEqual({ next: 21 });
    // Run ở stage cuối (finalize, chỉ số 21) + quay lại bước 20 ⇒ mọi CHECK đã nới nhận. Một tx owner (FK hội thoại ↔ run).
    const run = crypto.randomUUID();
    const conv = crypto.randomUUID();
    const flow = crypto.randomUUID();
    const s = await step(
      "run21",
      o.begin(async (tx) => {
        await tx`set local lock_timeout = '3s'`;
        await tx`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
          values (${conv}, ${T}, ${A}, 'd1', 'd1', ${run})`;
        await tx`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
          values (${flow}, ${T}, ${A}, ${conv}, 'd1', 1)`;
        await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by,
            origin_kind, input, conversation_id, flow_id, status, current_stage_idx, current_step, expires_at)
          values (${run}, ${T}, ${d?.id as string}, 1, '{}'::jsonb, ${A}, 'admin', 'x', ${conv}, ${flow}, 'running',
            21, 21, now() + interval '7 days')`;
        await tx`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status, round, back_to_step)
          values (${T}, ${run}, 21, 'running', 2, 20)`;
        const [r] = await tx<
          { s: number }[]
        >`select current_step as s from hub.process_runs where id = ${run}`;
        return r?.s;
      }),
    );
    expect(s).toBe(21);
    const err = await step(
      "step22",
      // Trần CHECK là cài đặt nền tảng (hub 0115, CR-123 p22): bước hợp lệ 0..CEILING-1 ⇒ CEILING bị chặn (không còn cố định 22).
      o`update hub.process_runs set current_step = ${PROCESS_STAGES_CEILING} where id = ${run}`.then(
        () => "",
        (e: Error) => e.message,
      ),
    );
    expect(err).toContain("process_runs_step_ck");
  });
});
