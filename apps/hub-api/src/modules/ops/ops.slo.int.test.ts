// CR-117 · int (DB test, role hub_api, đồng hồ giả): lượt kiểm ops-watch THẬT ghi mục SLO vào hub.ops_checks — truy vấn SLO chạy được
// dưới RLS scope system, slo.json của host làm tỷ lệ lỗi log vượt ngưỡng ⇒ ok → warn (2 lượt liên tiếp) → crit (4), có sự kiện + chuông.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../lib/db";
import { sloCheck } from "./adapters/checks/slo.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

let sql: Sql;
let db: Db;
let dir: string;
const T0 = new Date("2026-11-05T08:00:00Z");
const at = (round: number) => new Date(T0.getTime() + round * 31 * 60_000);
const writeSlo = (round: number, errors: number) =>
  writeFileSync(
    join(dir, "slo.json"),
    JSON.stringify({ at: at(round).toISOString(), window_min: 30, log: { lines: 1000, errors } }),
  );
const deps = () =>
  opsRoundDeps({
    db,
    ops: { checks: [sloCheck], statusDir: dir, timeoutMs: 5_000 },
    log: console as never,
  });
const row = async () =>
  (
    await sql<
      { status: string; message: string; value: { slos: { id: string; streak: number }[] } }[]
    >`
      select status, message, value from hub.ops_checks where check_key = 'slo'`
  )[0];

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  db = connectDb(HUB_API_URL, 4);
  dir = mkdtempSync(join(tmpdir(), "ops-slo-"));
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await sql`delete from hub.ops_checks`;
  await sql`delete from hub.ops_events`;
  await sql`update hub.ops_settings set settings = '{}', last_round_at = null, last_manual_at = null where id = 1`;
});

describe("ops-watch · mục SLO · int", () => {
  it("lượt kiểm ghi SLO vào ops_checks; vượt 1% lỗi log liên tiếp ⇒ warn rồi crit, có sự kiện chuyển trạng thái", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      writeSlo(i, 50); // 5% > 1%
      const r = await runChecksOnce(deps(), at(i));
      expect(r.ran).toBe(true);
      seen.push((await row())?.status ?? "none");
    }
    expect(seen).toEqual(["ok", "warn", "warn", "crit"]);
    const r = await row();
    expect(r?.message).toContain("tỷ lệ lỗi log");
    expect(r?.value.slos.find((s) => s.id === "log_error_rate")?.streak).toBe(4);
    const ev = await sql<{ to_status: string }[]>`
      select to_status from hub.ops_events where check_key = 'slo' and kind = 'status' order by id`;
    expect(ev.map((e) => e.to_status)).toContain("crit");
  });

  it("không có slo.json ⇒ vẫn chạy (truy vấn DB hợp lệ), trạng thái unknown, không ném lỗi", async () => {
    rmSync(join(dir, "slo.json"), { force: true });
    const r = await runChecksOnce(deps(), at(10));
    expect(r.ran).toBe(true);
    const slo = await row();
    expect(["unknown", "ok"]).toContain(slo?.status ?? "none");
  });
});
