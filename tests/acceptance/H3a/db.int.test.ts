// WRK-FR-22 · H3a-R05, R20 · spec §4 · `plan-db` §1 · test-plan-cases H3a §2.5 A20–A23: `hub.provider_state` thêm 6 cột NULL
// + 2 CHECK (migration 0008), quyền role không đổi (agent_runtime ghi, hub_api/hub_rw đọc), `hub.usage_logs` giữ nguyên cột.
// Hộp đen qua SQL (owner + role ứng dụng); DB sạch như H1 `prepareDb`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { AGENT_RT_URL, HUB_API_URL, ownerSql, prepareDb, type Sql } from "../H1/_fixtures";
import { insertHubConfig } from "../H1/_hub";

let sql: Sql;
let rt: Sql;
let api: Sql;
beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertHubConfig(sql);
  rt = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
  api = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
  await sql`insert into hub.provider_state (provider_key, status) values ('fake-cli', 'ok')
    on conflict (provider_key) do nothing`;
}, 60_000);
afterAll(async () => {
  await rt?.end();
  await api?.end();
  await sql?.end();
});

const NEW_COLS = {
  last_probe_at: "timestamp with time zone",
  last_ok_at: "timestamp with time zone",
  rate_limit_type: "text",
  utilization: "real",
  warn_at: "timestamp with time zone",
  warn_resets_at: "timestamp with time zone",
};

/** Ghi một giá trị vào `provider_state` (owner); trả mã SQLSTATE hoặc null. */
async function tryWrite(
  col: "rate_limit_type" | "utilization",
  v: string | number,
): Promise<string | null> {
  try {
    await sql`update hub.provider_state set ${sql({ [col]: v })} where provider_key = 'fake-cli'`;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  } finally {
    await sql`update hub.provider_state set rate_limit_type = null, utilization = null where provider_key = 'fake-cli'`;
  }
}

describe("A20–A23 · dữ liệu provider_state H3a [H3a-R05 · H3a-R20]", () => {
  it("WRK-FR-22 · A20 · 6 cột mới đúng kiểu, is_nullable=YES; hàng có sẵn mang NULL [H3a-R05 · spec §4]", async () => {
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'hub' and table_name = 'provider_state'
        and column_name = any(${sql.array(Object.keys(NEW_COLS))})`;
    expect(
      Object.fromEntries(rows.map((r) => [r.column_name, [r.data_type, r.is_nullable]])),
    ).toEqual(Object.fromEntries(Object.entries(NEW_COLS).map(([c, t]) => [c, [t, "YES"]])));
    const [row] =
      await sql`select last_probe_at, last_ok_at, rate_limit_type, utilization, warn_at, warn_resets_at
      from hub.provider_state where provider_key = 'fake-cli'`;
    expect(Object.values(row ?? { x: 1 }).every((v) => v === null)).toBe(true);
  });

  it("WRK-FR-22 · A21 · CHECK: rate_limit_type 'Five-Hour' / 41 ký tự, utilization 1.5 / −0.1 → 23514; five_hour, 0, 1 → được [H3a-R05]", async () => {
    for (const bad of ["Five-Hour", "a".repeat(41)])
      expect({ bad, code: await tryWrite("rate_limit_type", bad) }).toEqual({ bad, code: "23514" });
    for (const bad of [1.5, -0.1])
      expect({ bad, code: await tryWrite("utilization", bad) }).toEqual({ bad, code: "23514" });
    expect(await tryWrite("rate_limit_type", "five_hour")).toBeNull();
    for (const ok of [0, 1]) expect(await tryWrite("utilization", ok)).toBeNull();
  });

  it("WRK-FR-22 · A22 · role agent_runtime UPDATE được 6 cột; hub_api (hub_rw) SELECT được [H3a-R05 · plan P3]", async () => {
    await rt`update hub.provider_state set last_probe_at = now(), last_ok_at = now(), rate_limit_type = 'seven_day',
      utilization = 0.5, warn_at = now(), warn_resets_at = now() + interval '1 hour' where provider_key = 'fake-cli'`;
    const [r] =
      await api`select rate_limit_type, utilization from hub.provider_state where provider_key = 'fake-cli'`;
    expect(r).toMatchObject({ rate_limit_type: "seven_day", utilization: 0.5 });
    await sql`update hub.provider_state set last_probe_at = null, last_ok_at = null, rate_limit_type = null,
      utilization = null, warn_at = null, warn_resets_at = null where provider_key = 'fake-cli'`;
  });

  it("WRK-FR-22 · A23 · hub.usage_logs giữ nguyên danh sách cột trước H3a (0000 + job_id/cache_* H1–H2c; Admin/M4 đọc không đổi) [H3a-R20]", async () => {
    const cols = await sql<
      { column_name: string }[]
    >`select column_name from information_schema.columns
      where table_schema = 'hub' and table_name = 'usage_logs' order by ordinal_position`;
    expect(cols.map((c) => c.column_name)).toEqual([
      "id",
      "tenant_id",
      "run_id",
      "step_id",
      "user_id",
      "feature_id",
      "agent_id",
      "provider_key",
      "model",
      "billing",
      "input_tokens",
      "output_tokens",
      "cost_usd",
      "billable_usd",
      "overage",
      "latency_ms",
      "at",
      "job_id",
      "cache_read_tokens",
      "cache_write_tokens",
    ]);
  });
});
