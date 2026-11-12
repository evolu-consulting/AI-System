// CR-127 · Z1 · BR-79 · int (DB test, role hub_api): check `contract_state_drift` chạy một lượt ops-watch THẬT trên dữ liệu lệch dựng sẵn.
// Sạch ⇒ ok; processing mất lượt / done còn lượt mở / done thiếu hiệu lực ⇒ crit; yêu cầu chờ không sự kiện ⇒ có đếm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { contractStateDriftCheck } from "./adapters/checks/contract-state-drift.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

let o: Sql;
let db: Db;
let T = "";
let U = "";
const NOW = new Date("2026-11-10T08:00:00Z");
type Row = {
  status: string;
  message: string;
  value: {
    processing_no_run: number;
    closed_with_run: number;
    effect_drift: number;
    request_no_event: number;
  };
};
let minute = 0;
const round = async (): Promise<Row> => {
  await o`update hub.ops_settings set last_round_at = null where id = 1`;
  await runChecksOnce(
    opsRoundDeps({
      db,
      ops: { checks: [contractStateDriftCheck], timeoutMs: 5_000 },
      log: console as never,
    }),
    new Date(NOW.getTime() + 31 * 60_000 * minute++),
  );
  const [r] = await o<
    Row[]
  >`select status, message, value from hub.ops_checks where check_key = 'contract_state_drift'`;
  return r as Row;
};
const mk = async (status: string, extra: Record<string, unknown> = {}): Promise<string> => {
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ thử Z1",
    created_by: U,
    status,
    ...extra,
  } as never)} returning id`;
  return (r as { id: string }).id;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  [T] = (await tenants(o, 1, 9198)) as [string];
  [U] = (await users(o, T, 1, { from: 9198 })) as [string];
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 · Z1 · ops check contract_state_drift", () => {
  it("sạch ⇒ ok; dựng từng nhóm lệch ⇒ crit và đếm đúng", async () => {
    const clean = await round();
    expect([clean.status, clean.value.processing_no_run]).toEqual(["ok", 0]);
    // 1 · processing quá 10 phút, không lượt mở
    await mk("processing", { updated_at: new Date(Date.now() - 3_600_000) });
    // 2 · done mà trỏ lượt đang mở (và chưa có hiệu lực)
    const d = await mk("done");
    const [a] = await o<
      { id: string }[]
    >`insert into contracts.approvals (tenant_id, contract_id, status, started_by, mode)
      values (${T}, ${d}, 'level1', ${U}, 'engine') returning id`;
    await o`update contracts.contracts set run_id = ${(a as { id: string }).id}, effect = null where id = ${d}`;
    // 5 · yêu cầu thực hiện chờ không có sự kiện
    await o`insert into contracts.exec_requests (tenant_id, contract_id, kind, status, requested_by, requested_at)
      values (${T}, ${d}, 'hold', 'pending', ${U}, now() - interval '1 hour')`;
    const bad = await round();
    expect(bad.status).toBe("crit");
    expect(bad.value.processing_no_run).toBe(1);
    expect(bad.value.closed_with_run).toBe(1);
    expect(bad.value.effect_drift).toBe(1);
    expect(bad.value.request_no_event).toBe(1);
    expect(bad.message).toContain("HĐ đang xử lý nhưng không có lượt duyệt mở");
  });
});
