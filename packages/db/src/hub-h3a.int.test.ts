// WRK-FR-22 · WRK-FR-15 · migration 0008_h3a_provider_state (D1, plan H3a §3, plan-db H3a §1):
// 6 cột NULL của `hub.provider_state` (probe + tín hiệu quota), 2 CHECK, GRANT agent_runtime phủ cột mới, idempotent.
// Chạy trên DB Hub riêng (HUB_TEST_DATABASE_URL). Dữ liệu giả, không gọi dịch vụ ngoài.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, rollbackJournalFrom, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const asRole = (user: string, pw: string) => {
  const u = new URL(OWNER);
  u.username = user;
  u.password = pw;
  return u.toString();
};
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const rt = postgres(asRole("agent_runtime", "agent_runtime_dev_pw"), {
  max: 1,
  onnotice: () => {},
});

const KEY = "fake-cli";
const COLS = [
  "last_ok_at:timestamp with time zone",
  "last_probe_at:timestamp with time zone",
  "rate_limit_type:text",
  "utilization:real",
  "warn_at:timestamp with time zone",
  "warn_resets_at:timestamp with time zone",
];

/** Mã lỗi Postgres + tên ràng buộc (`23514:provider_state_utilization_check`); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; constraint_name?: string }) =>
      e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(e)),
  );
const set = (col: string, v: string | number | null) =>
  owner.unsafe(`update hub.provider_state set ${col} = $1 where provider_key = $2`, [v, KEY]);

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.providers (key, kind, vendor) values (${KEY}, 'subscription', 'fake')`;
  await owner`insert into hub.provider_state (provider_key) values (${KEY})`;
}, 60_000);
afterAll(async () => {
  await rt.end();
  await owner.end();
});

describe("WRK-FR-22 · 0008_h3a_provider_state D1 — cột + CHECK (int)", () => {
  test("6 cột mới đúng kiểu, nullable, không default; hàng có sẵn nhận NULL", async () => {
    const cols = await owner<{ n: string; nullable: string; def: string | null }[]>`
      select column_name || ':' || data_type as n, is_nullable as nullable, column_default as def
      from information_schema.columns
      where table_schema = 'hub' and table_name = 'provider_state'
        and column_name in ('last_probe_at', 'last_ok_at', 'rate_limit_type', 'utilization', 'warn_at', 'warn_resets_at')
      order by column_name`;
    expect(cols.map((c) => c.n)).toEqual(COLS);
    expect(cols.every((c) => c.nullable === "YES" && c.def === null)).toBe(true);
    const [r] =
      await owner`select last_probe_at, last_ok_at, rate_limit_type, utilization, warn_at, warn_resets_at
      from hub.provider_state where provider_key = ${KEY}`;
    expect(Object.values(r ?? { x: 1 }).every((v) => v === null)).toBe(true);
  });

  test("rate_limit_type: khớp ^[a-z0-9_]{1,40}$ hoặc NULL → ok; sai → 23514", async () => {
    for (const v of ["five_hour", "seven_day_opus", "a".repeat(40), null])
      expect(await code(set("rate_limit_type", v))).toBe("ok");
    for (const v of ["Five-Hour", "five hour", "", "a".repeat(41), "năm_giờ"])
      expect(await code(set("rate_limit_type", v))).toBe(
        "23514:provider_state_rate_limit_type_check",
      );
  });

  test("utilization: [0, 1] hoặc NULL → ok; 1.5, -0.1 → 23514", async () => {
    for (const v of [0, 0.42, 1, null]) expect(await code(set("utilization", v))).toBe("ok");
    for (const v of [1.5, -0.1])
      expect(await code(set("utilization", v))).toBe("23514:provider_state_utilization_check");
  });

  test("agent_runtime UPDATE + SELECT được 6 cột mới (GRANT mức bảng của 0000)", async () => {
    const at = new Date("2026-10-06T00:00:00Z");
    const [r] = await rt<{ t: string; u: number }[]>`update hub.provider_state set
      last_probe_at = ${at}, last_ok_at = ${at}, rate_limit_type = 'five_hour', utilization = 0.5,
      warn_at = ${at}, warn_resets_at = ${at}
      where provider_key = ${KEY} returning rate_limit_type as t, utilization as u`;
    expect(r).toEqual({ t: "five_hour", u: 0.5 });
  });
});

describe("WRK-FR-22 · 0008_h3a_provider_state D1 — idempotent (int)", () => {
  const file = new URL("../migrations-hub/0008_h3a_provider_state.sql", import.meta.url);
  const stmts = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const snap = async () =>
    (
      await owner<{ n: string }[]>`
        select conname || ':' || pg_get_constraintdef(oid) as n from pg_constraint
          where conrelid = 'hub.provider_state'::regclass
        union all select column_name || ':' || data_type from information_schema.columns
          where table_schema = 'hub' and table_name = 'provider_state'
        union all select grantee || ':' || privilege_type from information_schema.role_table_grants
          where table_schema = 'hub' and table_name = 'provider_state'
        order by 1`
    ).map((r) => r.n);

  test("lần 2 = {hub: 0, hubDev: 0}", async () => {
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });

  test("chạy lại toàn bộ câu của 0008 hai lần → không lỗi, cột/ràng buộc/grant không đổi", async () => {
    const before = await snap();
    for (const s of stmts) await owner.unsafe(s);
    for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });

  test("DB đã có 0007 (gỡ 6 cột + dòng journal) → áp 0008 (+ migration sau nó); dữ liệu cũ giữ, cột mới NULL", async () => {
    const before = await snap();
    await owner`update hub.provider_state set status = 'busy', consecutive_errors = 2 where provider_key = ${KEY}`;
    await owner.unsafe(`alter table hub.provider_state drop column last_probe_at, drop column last_ok_at,
      drop column rate_limit_type, drop column utilization, drop column warn_at, drop column warn_resets_at`);
    // Gỡ dòng journal của 0008 và mọi migration sau nó (migration sau idempotent, áp lại không đổi gì).
    const removed = await rollbackJournalFrom(owner, 8);
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({
      hub: removed,
      hubDev: 0,
    });
    const [r] = await owner`select status, consecutive_errors as n, utilization, last_probe_at
      from hub.provider_state where provider_key = ${KEY}`;
    expect(r).toEqual({ status: "busy", n: 2, utilization: null, last_probe_at: null });
    expect(await snap()).toEqual(before);
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });
});
