// CR-104 · ops-core · int lượt kiểm ops-watch (DB test, role hub_api, đồng hồ giả, KHÔNG sleep): chuyển trạng thái ⇒ đúng một sự
// kiện + đúng một chuông mỗi platform_admin đang hoạt động; không đổi ⇒ không ghi gì; hồi phục ⇒ chuông; check tắt không chạy;
// đổi tần suất có hiệu lực ở lượt kế; check ném lỗi/quá giờ ⇒ unknown; hai instance cùng lúc ⇒ một lượt; giữ 500 sự kiện.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { OPS_DEFAULT_SETTINGS, type OpsCheckKey, type OpsStatus } from "@ai/contracts/hub-admin";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../lib/db";
import type { OpsCheck } from "./application/ops.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

let sql: Sql;
let db: Db;
const PA2 = "a1000000-0000-4000-8000-000000000150"; // platform_admin thứ hai, ở tenant acme
const PA_OFF = "a1000000-0000-4000-8000-000000000151"; // platform_admin đã tắt ⇒ không nhận
const T0 = new Date("2026-10-30T08:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

let next: OpsStatus = "ok";
let calls = 0;
const fake = (key: OpsCheckKey): OpsCheck => ({
  key,
  async run() {
    calls++;
    return { status: next, value: { v: next }, message: `đo: ${next}`, hint: "sửa thế này" };
  },
});
const deps = (checks: OpsCheck[] = [fake("db_redis")]) =>
  opsRoundDeps({ db, ops: { checks, timeoutMs: 2_000 }, log: console as never });

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  const base = { password_hash: "x", must_change_password: false, role: "platform_admin" };
  await sql`insert into admin.users ${sql([
    {
      ...base,
      id: PA2,
      tenant_id: T.acme,
      username: "padmin2",
      display_name: "padmin2",
      active: true,
    },
    {
      ...base,
      id: PA_OFF,
      tenant_id: T.beta,
      username: "padmin3",
      display_name: "padmin3",
      active: false,
    },
  ])}`;
  db = connectDb(HUB_API_URL, 4);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});
beforeEach(async () => {
  next = "ok";
  calls = 0;
  await sql`delete from hub.ops_checks`;
  await sql`delete from hub.ops_events`;
  await sql`delete from hub.notifications where source = 'ops'`;
  await sql`update hub.ops_settings set settings = '{}', last_round_at = null, last_manual_at = null where id = 1`;
});

const bells = () =>
  sql<{ tenant_id: string; user_id: string; kind: string; link: string; dedup_key: string }[]>`
    select tenant_id, user_id, kind, link, dedup_key from hub.notifications where source = 'ops' order by kind, user_id`;
const statusEvents = async () => [
  ...(await sql<{ from_status: string | null; to_status: string }[]>`
    select from_status, to_status from hub.ops_events where kind = 'status' order by id`),
];

describe("ops-watch · chuyển trạng thái idempotent + chuông platform_admin", () => {
  it("check chuyển ok → crit thì mỗi platform_admin nhận đúng một thông báo, một sự kiện", async () => {
    expect((await runChecksOnce(deps(), at(0))).ran).toBe(true);
    expect(await bells()).toHaveLength(0); // lần đầu ok: không báo
    next = "crit";
    const r = await runChecksOnce(deps(), at(30));
    expect(r.ran && r.notified).toBe(2);
    const b = await bells();
    expect(b.map((x) => [x.user_id, x.tenant_id])).toEqual(
      [
        [USERS.padmin.id, T.platform],
        [PA2, T.acme],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    expect(b.every((x) => x.kind === "ops.crit" && x.link === "/system")).toBe(true);
    expect(b[0]?.dedup_key).toBe(`ops:db_redis:crit:${at(30).getTime()}`);
    expect(await statusEvents()).toEqual([
      { from_status: null, to_status: "ok" },
      { from_status: "ok", to_status: "crit" },
    ]);
    const [c] = await sql`select status, value, message, hint, changed_at from hub.ops_checks`;
    expect(c).toMatchObject({
      status: "crit",
      value: { v: "crit" },
      message: "đo: crit",
      hint: "sửa thế này",
    });
    expect(new Date(c?.changed_at).getTime()).toBe(at(30).getTime());
  });

  it("khi trạng thái một check không đổi giữa hai lượt thì không ghi thêm sự kiện, không chuông", async () => {
    next = "crit";
    await runChecksOnce(deps(), at(0));
    const ev = (await statusEvents()).length;
    const nb = (await bells()).length;
    const r = await runChecksOnce(deps(), at(30));
    expect(r.ran && r.transitions).toEqual([]);
    expect((await statusEvents()).length).toBe(ev);
    expect((await bells()).length).toBe(nb);
    const [c] = await sql`select checked_at, changed_at from hub.ops_checks`;
    expect(new Date(c?.checked_at).getTime()).toBe(at(30).getTime());
    expect(new Date(c?.changed_at).getTime()).toBe(at(0).getTime());
  });

  it("hồi phục crit → ok ⇒ chuông ops.recovered cho mỗi platform_admin", async () => {
    next = "crit";
    await runChecksOnce(deps(), at(0));
    next = "ok";
    const r = await runChecksOnce(deps(), at(30));
    expect(r.ran && r.notified).toBe(2);
    expect((await bells()).filter((x) => x.kind === "ops.recovered")).toHaveLength(2);
  });
});

describe("ops-watch · cấu hình + hạn lượt", () => {
  it("khi tắt một check thì check đó không chạy và không gửi cảnh báo", async () => {
    const s = { ...OPS_DEFAULT_SETTINGS, checks: { ...OPS_DEFAULT_SETTINGS.checks } };
    s.checks.db_redis = { ...s.checks.db_redis, enabled: false };
    await deps().repo.saveSettings(s, USERS.padmin.id, at(0));
    next = "crit";
    const r = await runChecksOnce(deps([fake("db_redis"), fake("disk")]), at(0));
    expect(calls).toBe(1); // chỉ disk
    expect(r.ran && r.results.map((x) => x.check_key)).toEqual(["disk"]);
    const keys = await sql`select check_key from hub.ops_checks`;
    expect(keys.map((x) => x.check_key)).toEqual(["disk"]);
    expect((await bells()).every((b) => b.dedup_key.startsWith("ops:disk:"))).toBe(true);
  });

  it("khi đổi tần suất từ 30 sang 10 phút thì lượt kiểm kế tiếp chạy theo 10 phút", async () => {
    expect((await runChecksOnce(deps(), at(0))).ran).toBe(true);
    expect(await runChecksOnce(deps(), at(10))).toEqual({ ran: false, reason: "not_due" });
    await deps().repo.saveSettings(
      { ...OPS_DEFAULT_SETTINGS, every_min: 10 },
      USERS.padmin.id,
      at(10),
    );
    expect((await runChecksOnce(deps(), at(10))).ran).toBe(true);
    expect((await runChecksOnce(deps(), at(19))).ran).toBe(false);
    expect((await runChecksOnce(deps(), at(20))).ran).toBe(true);
  });

  it("check ném lỗi / quá giờ ⇒ unknown + thông điệp, các check khác vẫn ghi", async () => {
    const boom: OpsCheck = {
      key: "tls",
      async run() {
        throw new TypeError("x");
      },
    };
    const hang: OpsCheck = {
      key: "backup",
      timeoutMs: 30,
      run: (d) =>
        new Promise((_, reject) =>
          d.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    };
    const r = await runChecksOnce(deps([boom, hang, fake("disk")]), at(0));
    expect(r.ran).toBe(true);
    const rows = await sql<{ check_key: string; status: string; message: string }[]>`
      select check_key, status, message from hub.ops_checks order by check_key`;
    expect([...rows]).toEqual([
      { check_key: "backup", status: "unknown", message: "Quá thời gian kiểm (30 ms)" },
      { check_key: "disk", status: "ok", message: "đo: ok" },
      { check_key: "tls", status: "unknown", message: "Check lỗi: TypeError" },
    ]);
  });

  it("hai instance gọi runChecksOnce cùng lúc ⇒ chỉ một lượt chạy", async () => {
    next = "crit";
    const [a, b] = await Promise.all([runChecksOnce(deps(), at(0)), runChecksOnce(deps(), at(0))]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect(calls).toBe(1);
    expect(await statusEvents()).toHaveLength(1);
    expect(await bells()).toHaveLength(2);
  });

  it("giữ 500 sự kiện mới nhất sau mỗi lượt", async () => {
    await sql`insert into hub.ops_events (kind, detail, at)
      select 'settings_changed', '{}'::jsonb, now() from generate_series(1, 600)`;
    next = "warn";
    await runChecksOnce(deps(), at(0));
    const [n] = await sql<{ n: number; last: string }[]>`
      select count(*)::int as n, (select to_status from hub.ops_events order by id desc limit 1) as last from hub.ops_events`;
    expect(n).toEqual({ n: 500, last: "warn" });
  });
});
