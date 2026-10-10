// HUB-FR-104 · B1 · S0-01 (test-plan-int §1): migration `0019_pa_process_engine.sql` chạy lần 2 không lỗi (idempotent);
// 11 bảng mới + `process_thread_events` + cột null trên bảng chung (plan §2.1–2.2, plan-thread §3). Chưa có file ⇒ đỏ ở expect.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../_support/modules";
import { type Sql, setupPa } from "../_support/pa";
import { columnInfo, tableExists } from "../_support/schema";

let sql: Sql;
beforeAll(async () => {
  ({ sql } = await setupPa());
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

const DIR = join(ROOT, "packages/db/migrations-hub");
const file0019 = (): string | undefined => readdirSync(DIR).find((f) => /^0019_.*\.sql$/.test(f));
const TABLES = [
  "process_defs",
  "process_runs",
  "stage_runs",
  "team_runs",
  "process_outputs",
  "review_tasks",
  "review_task_assignees",
  "process_notices",
  "agent_teams",
  "agent_team_members",
  "agent_team_entitlements",
  "process_thread_events",
];
const COLUMNS: [string, string][] = [
  ["runs", "process_run_id"],
  ["runs", "stage_run_id"],
  ["runs", "team_run_id"],
  ["conversations", "process_run_id"],
  ["room_messages", "process_run_id"],
  ["room_messages", "process_kind"],
  ["room_messages", "process_meta"],
];

describe("S0-01 · migration 0019 [HUB-FR-104]", () => {
  it("HUB-FR-104 · S0-01 · chạy 0019 lần 2 không lỗi; 12 bảng + cột mới (null) tồn tại", async () => {
    const f = file0019();
    expect({ file0019: f !== undefined }).toEqual({ file0019: true });
    if (!f) return;
    await sql.unsafe(readFileSync(join(DIR, f), "utf8"));
    const tables: Record<string, boolean> = {};
    for (const t of TABLES) tables[t] = await tableExists(sql, `hub.${t}`);
    expect(tables).toEqual(Object.fromEntries(TABLES.map((t) => [t, true])));
    for (const [t, c] of COLUMNS)
      expect({ col: `${t}.${c}`, ...(await columnInfo(sql, t, c)) }).toEqual({
        col: `${t}.${c}`,
        exists: true,
        nullable: true,
      });
  });
});
