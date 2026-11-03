// CR-116 · cr116-db-reliable · mất kết nối giữa transaction (pg_terminate_backend chính tiến trình của tx) với
// `withHubScope` (hub-api) và `withScope` (admin-api): không lỗi nào thoát ra tiến trình (postgres.js 3.4.9 ném
// `TypeError socket.write` trong setImmediate — vá ở patches/postgres@3.4.9.patch), người gọi nhận lỗi đã phân loại, không
// ghi nửa chừng. Chết TRƯỚC COMMIT ⇒ chạy lại (tx đã rollback); chết TRONG COMMIT ⇒ TX_OUTCOME_UNKNOWN, không chạy lại mù.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { NIL_SCOPE, type Tx, withScope } from "./scope";
import { withDatabase } from "./test-db";
import { TX_OUTCOME_UNKNOWN } from "./tx-retry";

const BASE = process.env.TEST_DATABASE_URL;
const ADMIN_API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!BASE || !ADMIN_API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");
const HUB_OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const hubApiUrl = (() => {
  const u = new URL(HUB_OWNER);
  u.username = "hub_api";
  u.password = "hub_api_dev_pw";
  return u.toString();
})();

const T = "cr116_txkill";
const hubOwner = postgres(HUB_OWNER, { max: 1, onnotice: () => {} });
const admOwner = postgres(BASE, { max: 1, onnotice: () => {} });
const hubDb = createDb(hubApiUrl, { max: 1 });
const admDb = createDb(ADMIN_API, { max: 1 });

/** Bảng thử + trigger hoãn tới COMMIT: hàng `k = 'commit-kill'` ⇒ tiến trình tự kết thúc ĐANG COMMIT. */
async function setup(owner: postgres.Sql, role: string): Promise<void> {
  await owner.unsafe(`
    drop table if exists public.${T};
    create table public.${T} (k text primary key, attempt int not null);
    create or replace function public.${T}_kill() returns trigger language plpgsql as $$
    begin
      if new.k like 'commit-kill%' then perform pg_terminate_backend(pg_backend_pid()); end if;
      return null;
    end $$;
    create constraint trigger ${T}_at_commit after insert on public.${T}
      deferrable initially deferred for each row execute function public.${T}_kill();
    grant select, insert, update, delete on public.${T} to ${role};
  `);
}

beforeAll(async () => {
  await runMigrations({ url: HUB_OWNER, appEnv: "test" });
  await runHubMigrations({ url: HUB_OWNER, appEnv: "test" });
  await runMigrations({ url: BASE, appEnv: "test" });
  await setup(hubOwner, "hub_api");
  await setup(admOwner, new URL(ADMIN_API).username);
});
afterAll(async () => {
  await hubDb.close();
  await admDb.close();
  await hubOwner.unsafe(
    `drop table if exists public.${T}; drop function if exists public.${T}_kill()`,
  );
  await admOwner.unsafe(
    `drop table if exists public.${T}; drop function if exists public.${T}_kill()`,
  );
  await hubOwner.end();
  await admOwner.end();
});

// Bắt mọi lỗi thoát ra tiến trình trong lúc test (lỗi driver ném trong setImmediate không ai bắt được).
const escaped: unknown[] = [];
const onEscape = (e: unknown) => escaped.push(e);
beforeEach(() => {
  escaped.length = 0;
  process.on("uncaughtException", onEscape);
  process.on("unhandledRejection", onEscape);
});
afterEach(() => {
  process.off("uncaughtException", onEscape);
  process.off("unhandledRejection", onEscape);
});
/** Xả pha check/timers của vòng sự kiện (lỗi driver nằm trong setImmediate) — không chờ mốc giờ. */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

type Run = <R>(fn: (tx: Tx) => Promise<R>) => Promise<R>;
const cases: [string, postgres.Sql, Run][] = [
  ["withHubScope (hub-api)", hubOwner, (fn) => withHubScope(hubDb, { kind: "system" }, fn)],
  ["withScope (admin-api)", admOwner, (fn) => withScope(admDb, NIL_SCOPE, fn)],
];

const insert = (tx: Tx, k: string, n: number) =>
  tx.execute(dsql.raw(`insert into public.${T} (k, attempt) values ('${k}', ${n})`));
const rows = async (owner: postgres.Sql, k: string) =>
  (await owner.unsafe(`select k, attempt from public.${T} where k like '${k}%' order by k`)).map(
    (r) => [r.k as string, r.attempt as number],
  );

describe("CR-116 · mất kết nối giữa transaction (int)", () => {
  for (const [name, owner, run] of cases) {
    test(`${name} · chết TRƯỚC COMMIT ⇒ chạy lại, đúng 1 hàng của lần thành công, không lỗi thoát tiến trình`, async () => {
      let n = 0;
      const out = await run(async (tx) => {
        n++;
        await insert(tx, "pre-kill", n);
        if (n === 1) await tx.execute(dsql`select pg_terminate_backend(pg_backend_pid())`);
        return n;
      });
      await drain();
      expect(out).toBe(2);
      expect(await rows(owner, "pre-kill")).toEqual([["pre-kill", 2]]);
      expect(escaped.map(String)).toEqual([]);
      // pool dùng lại được sau khi nối lại
      expect(await run(async (tx) => (await tx.execute(dsql`select 1 as x`)).length)).toBe(1);
    });

    test(`${name} · chết TRONG COMMIT ⇒ TX_OUTCOME_UNKNOWN, không chạy lại, không lỗi thoát tiến trình`, async () => {
      let n = 0;
      const err = await run(async (tx) => {
        n++;
        await insert(tx, "commit-kill", n);
        return n;
      }).then(
        () => null,
        (e: { code?: string }) => e,
      );
      await drain();
      expect(err?.code).toBe(TX_OUTCOME_UNKNOWN);
      expect(n).toBe(1);
      // server đã rollback (trigger hoãn chạy trước bản ghi commit) — người gọi đọc lại mới biết
      expect(await rows(owner, "commit-kill")).toEqual([]);
      expect(escaped.map(String)).toEqual([]);
    });
  }
});
