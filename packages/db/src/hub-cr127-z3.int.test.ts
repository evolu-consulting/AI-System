// CR-127 · Z3 · migration 0135_cr127_remove_legacy_approval_flows (int): def có stage tool `contracts-route`/`contracts-finalize` bị gỡ gán + lưu trữ,
// lượt mở ⇒ `cancelled` (reason legacy_flow_removed), HĐ processing gắn lượt ⇒ draft + contract_events; def mới (không tool) + công ty khác
// KHÔNG bị chạm; chạy lại vô hại. Cách làm: migrate đủ (0135 chạy trên DB rỗng = no-op), dựng dữ liệu cũ bằng owner (bỏ FK), rồi chạy lại đúng file SQL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import type postgres from "postgres";

let owner: Sql;

const TA = "01900000-0000-7000-8000-00000127a301";
const TB = "01900000-0000-7000-8000-00000127b301";
const U = "01900000-0000-7000-8000-00000127a311";
const id = (n: number) => `01900000-0000-7000-8000-00000127c3${String(n).padStart(2, "0")}`;
const [LEGACY, MODERN, RUN_A, RUN_B, RUN_OK, CA, CB, CC, SR_A, SR_OK, TASK_A, TASK_OK] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const SLOT = "contracts.approval";
const STAGE_TOOL = [{ key: "route", executor: { kind: "tool", tool_key: "contracts-route" } }];
const STAGE_OK = [{ key: "a", executor: { kind: "approve" } }];

async function defRow(tx: postgres.TransactionSql, defId: string, key: string, stages: unknown) {
  await tx`insert into hub.process_defs (id, tenant_id, key, name, stages, enabled, published_version, slot)
    values (${defId}, null, ${key}, ${key}, ${tx.json(stages as never)}, true, 1, 'contracts.approval')`;
  await tx`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${defId}, 1, ${key}, ${tx.json(stages as never)})`;
}
async function runRow(
  tx: postgres.TransactionSql,
  runId: string,
  t: string,
  def: string,
  c: string,
  st: string,
) {
  await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, status, pack_key, pack_record_id)
    values (${runId}, ${t}, ${def}, 1, '{}'::jsonb, ${U}, 'admin', '', ${runId}, ${runId}, ${st}, 'contracts', ${c})`;
}
async function contract(c: string, t: string, status: string) {
  await owner`insert into contracts.contracts (id, tenant_id, kind, title, direction, status, extract_state, owner_user_id, created_by, version, fields)
    values (${c}, ${t}, 'contract', 'z3', 'purchase', ${status}, 'ready', ${U}, ${U}, 1, '{}'::jsonb)`;
}
async function approval(c: string, t: string, run: string, status: string) {
  await owner`insert into contracts.approvals (tenant_id, contract_id, status, started_by, mode, engine_run_id)
    values (${t}, ${c}, ${status}, ${U}, 'engine', ${run})`;
}

const sqlFile = () =>
  Bun.file(
    new URL("../migrations-hub/0135_cr127_remove_legacy_approval_flows.sql", import.meta.url),
  ).text();
const packFile = () =>
  Bun.file(
    new URL(
      "../migrations-pack-contracts/0100_cr127_close_cancelled_flow_contracts.sql",
      import.meta.url,
    ),
  ).text();
/** Hub (huỷ lượt, gỡ gán) rồi gói 0100 (HĐ về draft + đóng lượt approvals) — đúng thứ tự `migrate.ts`. */
const rerun = async () => {
  await owner.unsafe(await sqlFile());
  await owner.unsafe(await packFile());
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await defRow(tx, LEGACY, "z3-legacy", STAGE_TOOL);
    await defRow(tx, MODERN, "z3-modern", STAGE_OK);
    for (const t of [TA, TB]) {
      await tx`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${t}, ${LEGACY}, 'contracts.approval')`;
    }
    await tx`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${TB}, ${MODERN}, 'contracts.other')`;
    await runRow(tx, RUN_A, TA, LEGACY, CA, "needs_decision");
    await runRow(tx, RUN_B, TB, LEGACY, CB, "needs_decision");
    await runRow(tx, RUN_OK, TB, MODERN, CC, "waiting_review");
    await tx`insert into hub.process_slots (slot, default_def_id) values (${SLOT}, ${LEGACY})
      on conflict (slot) do update set default_def_id = excluded.default_def_id`;
    await tx`insert into hub.process_routings (tenant_id, slot) values (${TA}, ${SLOT}) on conflict do nothing`;
    await tx`insert into hub.process_routing_rules (tenant_id, slot, priority, def_id, is_default)
      values (${TA}, ${SLOT}, 0, ${LEGACY}, true)`;
    await tx`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${TA}, ${LEGACY}, true), (${TB}, ${MODERN}, true)`;
    for (const [sr, run, t] of [
      [SR_A, RUN_A, TA],
      [SR_OK, RUN_OK, TB],
    ] as const) {
      await tx`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status) values (${sr}, ${t}, ${run}, 0, 'waiting_review')`;
      await tx`insert into hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at, idempotency_key, timezone)
        values (${t}, ${run}, ${sr}, 'wait_until', now() + interval '1 day', ${`z3-${sr}`}, 'UTC')`;
    }
    await tx`insert into hub.review_tasks (id, tenant_id, process_run_id, stage_run_id, kind, subject_ref) values
      (${TASK_A}, ${TA}, ${RUN_A}, ${SR_A}, 'milestone', 'z3'), (${TASK_OK}, ${TB}, ${RUN_OK}, ${SR_OK}, 'milestone', 'z3')`;
  });
  await contract(CA, TA, "processing");
  await contract(CB, TB, "processing");
  await contract(CC, TB, "processing");
  await approval(CA, TA, RUN_A, "level2");
  await approval(CC, TB, RUN_OK, "level2");
});
/** Dọn mọi hàng nền (tenant giả): DB test dùng lại giữa các lần chạy, migration backfill (đọc `contracts.*`) vấp FK tenant nếu còn sót. */
async function wipe() {
  const [runs, ts, cs] = [
    [RUN_A, RUN_B, RUN_OK],
    [TA, TB],
    [CA, CB, CC],
  ];
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from hub.review_tasks where process_run_id in ${tx(runs)}`;
    await tx`delete from hub.process_timers where process_run_id in ${tx(runs)}`;
    await tx`delete from hub.stage_runs where process_run_id in ${tx(runs)}`;
    await tx`delete from hub.process_runs where id in ${tx(runs)}`;
    await tx`delete from hub.process_routing_rules where tenant_id in ${tx(ts)}`;
    await tx`delete from hub.process_routings where tenant_id in ${tx(ts)}`;
    await tx`delete from hub.process_tenant_defs where tenant_id in ${tx(ts)}`;
    await tx`delete from hub.company_flows where tenant_id in ${tx(ts)}`;
    await tx`delete from hub.process_slots where slot = ${SLOT}`;
    await tx`delete from hub.process_def_releases where def_id in (${LEGACY}, ${MODERN})`;
    await tx`delete from hub.process_defs where id in (${LEGACY}, ${MODERN})`;
    await tx`delete from contracts.contract_events where contract_id in ${tx(cs)}`;
    await tx`delete from contracts.approvals where tenant_id in ${tx(ts)}`;
    await tx`delete from contracts.contracts where id in ${tx(cs)}`;
  });
}
afterAll(async () => {
  await wipe();
  await owner.end();
});

describe("CR-127 Z3 · 0135 gỡ quy trình duyệt kiểu cũ (int)", () => {
  test("def cũ bị gỡ gán + lưu trữ; lượt huỷ; HĐ về draft có event; def mới không bị chạm", async () => {
    await rerun();
    const [d] =
      await owner`select deleted_at is not null as gone, enabled from hub.process_defs where id = ${LEGACY}`;
    expect(d).toMatchObject({ gone: true, enabled: false });
    expect(
      (await owner`select 1 from hub.process_tenant_defs where def_id = ${LEGACY}`).length,
    ).toBe(0);
    const runs =
      await owner`select id::text, status, decision->>'reason' as reason from hub.process_runs
      where id in (${RUN_A}, ${RUN_B}, ${RUN_OK}) order by id`;
    const by = Object.fromEntries(runs.map((r) => [r.id, r]));
    expect(by[RUN_A]).toMatchObject({ status: "cancelled", reason: "legacy_flow_removed" });
    expect(by[RUN_B]).toMatchObject({ status: "cancelled", reason: "legacy_flow_removed" });
    expect(by[RUN_OK]?.status).toBe("waiting_review"); // def mới: nguyên
    const cs =
      await owner`select id::text, status from contracts.contracts where id in (${CA}, ${CB}, ${CC})`;
    const st = Object.fromEntries(cs.map((c) => [c.id, c.status]));
    expect(st[CA]).toBe("draft");
    expect(st[CB]).toBe("draft");
    expect(st[CC]).toBe("processing"); // HĐ của lượt không thuộc def cũ: không chạm
    const ap =
      await owner`select contract_id::text as c, status from contracts.approvals where contract_id in (${CA}, ${CC})`;
    const apBy = Object.fromEntries(ap.map((a) => [a.c, a.status]));
    expect(apBy[CA]).toBe("cancelled"); // lượt duyệt của lượt engine đã huỷ: đóng (không chặn Gửi duyệt lại)
    expect(apBy[CC]).toBe("level2"); // lượt của HĐ không thuộc diện gỡ: nguyên
    const ev =
      await owner`select data->>'code' as code, data->>'ev' as ev from contracts.contract_events
      where contract_id = ${CA} and type = 'status_changed'`;
    expect([...ev]).toEqual([{ code: "legacy_flow_removed", ev: "flow_cancelled" }]);
    const [m] =
      await owner`select deleted_at is null as live from hub.process_defs where id = ${MODERN}`;
    expect(m?.live).toBe(true);
    expect(
      (await owner`select 1 from hub.process_tenant_defs where def_id = ${MODERN}`).length,
    ).toBe(1);
  });

  test("lượt bị huỷ: stage/hẹn/việc mở đóng; gán xoá; khe mặc định bị xoá (không còn quy trình mặc định); tenant khác nguyên", async () => {
    const [sr] = await owner`select status from hub.stage_runs where id = ${SR_A}`;
    expect(sr?.status).toBe("cancelled");
    const [tm] =
      await owner`select cancelled_at is not null as c from hub.process_timers where process_run_id = ${RUN_A}`;
    expect(tm?.c).toBe(true);
    const [tk] = await owner`select status, result from hub.review_tasks where id = ${TASK_A}`;
    expect(tk).toMatchObject({ status: "closed", result: "cancelled" });
    expect(
      (await owner`select 1 from hub.process_routing_rules where def_id = ${LEGACY}`).length,
    ).toBe(0);
    expect((await owner`select 1 from hub.company_flows where flow_id = ${LEGACY}`).length).toBe(0);
    expect((await owner`select 1 from hub.process_slots where slot = ${SLOT}`).length).toBe(0); // khe không còn mặc định ⇒ xoá dòng
    const [sb] = await owner`select status from hub.stage_runs where id = ${SR_OK}`;
    expect(sb?.status).toBe("waiting_review");
    const [tb] =
      await owner`select cancelled_at is null as open from hub.process_timers where process_run_id = ${RUN_OK}`;
    expect(tb?.open).toBe(true);
    const [kb] = await owner`select status from hub.review_tasks where id = ${TASK_OK}`;
    expect(kb?.status).toBe("open");
    expect((await owner`select 1 from hub.company_flows where flow_id = ${MODERN}`).length).toBe(1);
  });

  test("chạy lại vô hại: không thêm event, không đổi trạng thái", async () => {
    const [before] = await owner`select version from contracts.contracts where id = ${CA}`;
    await rerun();
    const ev =
      await owner`select 1 from contracts.contract_events where contract_id = ${CA} and type = 'status_changed'`;
    expect(ev.length).toBe(1);
    const [c] = await owner`select status, version from contracts.contracts where id = ${CA}`;
    expect(c?.status).toBe("draft");
    expect(c?.version).toBe(before?.version); // version không tăng thêm
  });
});
