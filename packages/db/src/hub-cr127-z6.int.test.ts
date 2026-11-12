// CR-127 · Z6 · migration 0138_cr127_remove_shared_company_flows (int): quy trình DÙNG CHUNG (tenant_id NULL) của app contracts/community bị gỡ
// khỏi công ty (`company_flows`) + lưu trữ khi không còn lượt mở; def có lượt mở chỉ bị gỡ gán (giữ def, lượt nguyên); def khe, app khác,
// def công ty KHÔNG bị chạm; chạy lại vô hại (lượt xong ⇒ lần chạy kế lưu trữ nốt). Cách làm: migrate đủ (0138 trên DB rỗng = no-op), dựng
// dữ liệu cũ bằng owner (bỏ FK), rồi chạy lại đúng file SQL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import type postgres from "postgres";

let owner: Sql;

const TA = "01900000-0000-7000-8000-00000127a601";
const TB = "01900000-0000-7000-8000-00000127b601";
const U = "01900000-0000-7000-8000-00000127a611";
const id = (n: number) => `01900000-0000-7000-8000-00000127c6${String(n).padStart(2, "0")}`;
const [PURCHASE, COMM_OPEN, COMM_SLOT, DLC, OWN, RUN_OPEN] = [1, 2, 3, 4, 5, 6].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const STAGES = [{ key: "a", executor: { kind: "approve" } }];

async function defRow(
  tx: postgres.TransactionSql,
  defId: string,
  key: string,
  o: { tenant: string | null; app: string; slot?: string },
) {
  await tx`insert into hub.process_defs (id, tenant_id, key, name, stages, enabled, app, slot)
    values (${defId}, ${o.tenant}, ${key}, ${key}, ${tx.json(STAGES as never)}, true, ${o.app}, ${o.slot ?? null})`;
}

const sqlFile = () =>
  Bun.file(
    new URL("../migrations-hub/0138_cr127_remove_shared_company_flows.sql", import.meta.url),
  ).text();
const rerun = async () => owner.unsafe(await sqlFile());
const ALL = [PURCHASE, COMM_OPEN, COMM_SLOT, DLC, OWN];

async function wipe() {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from hub.company_flows where tenant_id in (${TA}, ${TB})`;
    await tx`delete from hub.process_runs where id = ${RUN_OPEN}`;
    await tx`delete from hub.process_defs where id in ${tx(ALL)}`;
  });
}

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  await wipe();
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await defRow(tx, PURCHASE, "z6-purchase", { tenant: null, app: "contracts" });
    await defRow(tx, COMM_OPEN, "z6-comm-open", { tenant: null, app: "community" });
    await defRow(tx, COMM_SLOT, "z6-comm-slot", {
      tenant: null,
      app: "community",
      slot: "community.z6",
    });
    await defRow(tx, DLC, "z6-dlc", { tenant: null, app: "dlc" });
    await defRow(tx, OWN, "z6-own", { tenant: TA, app: "contracts" });
    await tx`insert into hub.company_flows (tenant_id, flow_id, enabled) values
      (${TA}, ${PURCHASE}, true), (${TB}, ${PURCHASE}, true), (${TA}, ${COMM_OPEN}, true),
      (${TA}, ${COMM_SLOT}, false), (${TA}, ${DLC}, true), (${TA}, ${OWN}, true)`;
    await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
        conversation_id, flow_id, status)
      values (${RUN_OPEN}, ${TA}, ${COMM_OPEN}, 1, '{}'::jsonb, ${U}, 'admin', '', ${RUN_OPEN}, ${RUN_OPEN}, 'waiting_review')`;
  });
});
afterAll(async () => {
  await wipe();
  await owner.end();
});

const cfOf = async (flow: string) =>
  (await owner`select 1 from hub.company_flows where flow_id = ${flow}`).length;
const liveOf = async (flow: string) => {
  const [d] =
    await owner`select deleted_at is null as live, enabled from hub.process_defs where id = ${flow}`;
  return d as { live: boolean; enabled: boolean };
};

describe("CR-127 Z6 · 0138 gỡ quy trình dùng chung khỏi công ty (int)", () => {
  test("gỡ gán mọi def dùng chung contracts/community; lưu trữ def không còn lượt mở; không chạm app khác / def công ty", async () => {
    const [v0] = await owner`select hub_config_version as v from hub.config_meta where id = 1`;
    await rerun();
    expect(await cfOf(PURCHASE)).toBe(0); // cả hai công ty
    expect(await cfOf(COMM_OPEN)).toBe(0);
    expect(await cfOf(COMM_SLOT)).toBe(0);
    expect(await liveOf(PURCHASE)).toMatchObject({ live: false, enabled: false });
    expect(await liveOf(COMM_OPEN)).toMatchObject({ live: true, enabled: true }); // còn lượt mở: chỉ gỡ gán
    expect(await liveOf(COMM_SLOT)).toMatchObject({ live: true, enabled: true }); // def khe: nền tảng, giữ
    expect(await cfOf(DLC)).toBe(1); // app khác nguyên
    expect(await liveOf(DLC)).toMatchObject({ live: true, enabled: true });
    expect(await cfOf(OWN)).toBe(1); // def công ty nguyên
    expect(await liveOf(OWN)).toMatchObject({ live: true, enabled: true });
    const [run] = await owner`select status from hub.process_runs where id = ${RUN_OPEN}`;
    expect(run?.status).toBe("waiting_review"); // lượt đang chạy KHÔNG bị chạm
    const [v1] = await owner`select hub_config_version as v from hub.config_meta where id = 1`;
    expect(v1?.v).toBeGreaterThan(v0?.v);
  });

  test("chạy lại vô hại; lượt xong ⇒ lần chạy kế lưu trữ nốt def đã gỡ gán", async () => {
    const [v0] = await owner`select hub_config_version as v from hub.config_meta where id = 1`;
    await rerun(); // còn lượt mở, không đổi gì ⇒ không bump cache
    const [v1] = await owner`select hub_config_version as v from hub.config_meta where id = 1`;
    expect(v1?.v).toBe(v0?.v);
    expect(await liveOf(COMM_OPEN)).toMatchObject({ live: true });
    await owner`update hub.process_runs set status = 'done', finished_at = now() where id = ${RUN_OPEN}`;
    await rerun();
    expect(await liveOf(COMM_OPEN)).toMatchObject({ live: false, enabled: false });
    expect(await liveOf(COMM_SLOT)).toMatchObject({ live: true });
    expect(await cfOf(OWN)).toBe(1);
  });
});
