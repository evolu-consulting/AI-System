// CR-118 · cr118-r1-fixes #2 · UW-FR-17 · flow độc lập lọc theo tenant TRONG SQL trước `limit` (pool hub_api thật): tenant
// khác có nhiều hơn giới hạn flow độc lập (tên xếp trước) ⇒ flow của tenant hỏi + flow dùng chung vẫn có; không lộ của tenant khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { loadHubExtras, STANDALONE_MAX } from "./capabilities.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 891)) as [string, string];
  await o`insert into hub.process_defs (tenant_id, key, name, stages)
    select ${B}, 'r1x-b-' || g, 'AAA ' || lpad(g::text, 4, '0'), '[{"key":"s0"}]'::jsonb
    from generate_series(1, ${STANDALONE_MAX + 10}::int) g`;
  await o`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${A}, 'r1x-a-own', 'ZZZ của A', '[{"key":"s0"}]'::jsonb),
           (null, 'r1x-shared', 'ZZZ dùng chung', '[{"key":"s0"}]'::jsonb)`;
  db = connectDb(urls().hubApi, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-118 · cr118-r1-fixes · capabilities.repo", () => {
  it("tenant khác > giới hạn ⇒ flow của tenant hỏi vẫn có", async () => {
    const x = await loadHubExtras(db, A);
    const names = x.standalone.map((d) => d.name);
    expect({
      own: names.includes("ZZZ của A"),
      shared: names.includes("ZZZ dùng chung"),
      leaked: x.standalone.some((d) => d.tenantId === B),
      slotsOther: x.slots.some((s) => s.tenantId !== null && s.tenantId !== A),
    }).toEqual({ own: true, shared: true, leaked: false, slotsOther: false });
    const b = await loadHubExtras(db, B);
    expect(b.standalone.length).toBe(STANDALONE_MAX);
  });
});
