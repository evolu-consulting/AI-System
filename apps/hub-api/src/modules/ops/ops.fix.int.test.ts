// CR-104 · ops-fix-core · int sửa lỗi review lượt kiểm ops-watch (DB test, đồng hồ giả, KHÔNG sleep): chuông tính theo trạng
// thái đã biết gần nhất (qua `unknown` không báo lại/không mất hồi phục); lượt cũ ghi sau lượt mới bị bỏ; `prev` cũ quá 2×tần
// suất không đưa cho check; tắt rồi bật lại check không báo "đã hồi phục" giả.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { OPS_DEFAULT_SETTINGS, type OpsCheckKey, type OpsStatus } from "@ai/contracts/hub-admin";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../lib/db";
import type { OpsCheck, OpsCheckDeps } from "./application/ops.check";
import { runChecksNow, runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

let sql: Sql;
let db: Db;
const T0 = new Date("2026-10-30T08:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

let next: OpsStatus = "ok";
const fake = (key: OpsCheckKey = "db_redis"): OpsCheck => ({
  key,
  async run() {
    return { status: next, value: { v: next }, message: `đo: ${next}` };
  },
});
const deps = (checks: OpsCheck[] = [fake()]) =>
  opsRoundDeps({ db, ops: { checks, timeoutMs: 2_000 }, log: console as never });

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql); // một platform_admin đang hoạt động: padmin
  db = connectDb(HUB_API_URL, 4);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});
beforeEach(async () => {
  next = "ok";
  await sql`delete from hub.ops_checks`;
  await sql`delete from hub.ops_events`;
  await sql`delete from hub.notifications where source = 'ops'`;
  await sql`update hub.ops_settings set settings = '{}', last_round_at = null, last_manual_at = null where id = 1`;
});

const bells = async () => [
  ...(await sql<{ kind: string; user_id: string }[]>`
    select kind, user_id from hub.notifications where source = 'ops' order by seq`),
];
const seq = async (...ss: OpsStatus[]) => {
  for (const [i, s] of ss.entries()) {
    next = s;
    expect((await runChecksOnce(deps(), at(i * 30))).ran).toBe(true);
  }
};

describe("ops-fix-core · chuông theo trạng thái đã biết (qua unknown)", () => {
  it("crit → unknown → crit chỉ một chuông crit tổng cộng", async () => {
    await seq("ok", "crit", "unknown", "crit");
    expect(await bells()).toEqual([{ kind: "ops.crit", user_id: USERS.padmin.id }]);
    const ev =
      await sql`select from_status, to_status from hub.ops_events where kind = 'status' order by id`;
    expect(ev.map((e) => `${e.from_status}>${e.to_status}`)).toEqual([
      "null>ok",
      "ok>crit",
      "crit>unknown",
      "unknown>crit",
    ]);
  });

  it("warn → unknown → ok vẫn gửi chuông đã hồi phục", async () => {
    await seq("warn", "unknown", "ok");
    expect((await bells()).map((b) => b.kind)).toEqual(["ops.warn", "ops.recovered"]);
  });

  it("warn → unknown → crit báo crit (đổi so với trạng thái đã biết)", async () => {
    await seq("warn", "unknown", "crit");
    expect((await bells()).map((b) => b.kind)).toEqual(["ops.warn", "ops.crit"]);
  });
});

describe("ops-fix-core · lượt chồng nhau, prev, bật/tắt", () => {
  it("Kiểm tra ngay chồng lượt nền: lượt nền xong sau nhưng cũ hơn ⇒ không ghi đè, không chuyển trạng thái giả", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const running = new Promise<void>((r) => {
      started = r;
    });
    const slow: OpsCheck = {
      key: "db_redis",
      async run() {
        started();
        await gate;
        return { status: "crit", value: null, message: "cũ" };
      },
    };
    const loop = runChecksOnce(deps([slow]), at(0));
    await running;
    next = "ok";
    expect((await runChecksNow(deps(), new Date(at(0).getTime() + 30_000))).ran).toBe(true);
    release();
    const r = await loop;
    expect(r.ran && r.transitions).toEqual([]);
    const [c] = await sql`select status, message, checked_at from hub.ops_checks`;
    expect(c).toMatchObject({ status: "ok", message: "đo: ok" });
    expect(new Date(c?.checked_at).getTime()).toBe(at(0).getTime() + 30_000);
    expect(await bells()).toEqual([]);
    const [n] = await sql`select count(*)::int as n from hub.ops_events where kind = 'status'`;
    expect(n?.n).toBe(1);
  });

  it("prev cũ hơn 2× tần suất không đưa cho check; lượt kế bình thường thì có", async () => {
    const seen: Array<OpsCheckDeps["prev"]> = [];
    const spy: OpsCheck = {
      key: "public_hosts",
      async run(d) {
        seen.push(d.prev);
        return { status: "warn", value: { consecutive: 1 }, message: "lỗi" };
      },
    };
    await runChecksOnce(deps([spy]), at(0));
    await runChecksOnce(deps([spy]), at(30));
    await runChecksOnce(deps([spy]), at(30 + 61));
    expect(seen.map((p) => p?.public_hosts?.value ?? null)).toEqual([
      null,
      { consecutive: 1 },
      null,
    ]);
  });

  it("tắt rồi bật lại check không gửi chuông hồi phục giả", async () => {
    await seq("crit");
    const off = {
      ...OPS_DEFAULT_SETTINGS,
      checks: {
        ...OPS_DEFAULT_SETTINGS.checks,
        db_redis: { ...OPS_DEFAULT_SETTINGS.checks.db_redis, enabled: false },
      },
    };
    await deps().repo.saveSettings(off, USERS.padmin.id, at(10));
    const [d] = await sql`select status, value from hub.ops_checks where check_key = 'db_redis'`;
    expect(d).toMatchObject({ status: "unknown", value: null });
    await deps().repo.saveSettings(OPS_DEFAULT_SETTINGS, USERS.padmin.id, at(20));
    next = "ok";
    expect((await runChecksOnce(deps(), at(30))).ran).toBe(true);
    expect((await bells()).map((b) => b.kind)).toEqual(["ops.crit"]);
  });
});
