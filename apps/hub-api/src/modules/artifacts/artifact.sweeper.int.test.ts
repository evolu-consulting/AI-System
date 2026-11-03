// CR-114 · hub-agent-handoff · dọn artifact hết hạn: theo lô (số câu cố định), chỉ hàng `expires_at < now`, hai Hub chạy
// cùng lúc không xoá trùng / không lỗi (khoá thử advisory ⇒ một bên `skipped`, hoặc cả hai chạy nối tiếp).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sweepArtifactsOnce } from "./artifact.sweeper";

const T = { a: tenantId(1145), b: tenantId(1146) };
const NOW = new Date("2030-01-01T00:00:00Z");
const RUN = "00000000-0000-4000-8000-000000011450";
let db: Db;
let db2: Db;
let o: Sql;

const hex = (i: number) => i.toString(16).padStart(64, "0");

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(1);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 't1145', 'T1145'), (${T.b}, 't1146', 'T1146')
    on conflict do nothing`;
  // 25 hết hạn (xen 2 tenant) + 3 còn hạn so với NOW.
  await o`insert into hub.artifacts (tenant_id, key, kind, body, size_bytes, tokens, summary, expires_at)
    select case when i % 2 = 0 then ${T.a}::uuid else ${T.b}::uuid end, lpad(to_hex(i), 64, '0'), 'text', 'x', 1, 1, '',
      case when i <= 25 then ${NOW.toISOString()}::timestamptz - interval '1 hour'
           else ${NOW.toISOString()}::timestamptz + interval '1 day' end
    from generate_series(1, 28) i`;
  // Link run cho mọi artifact ⇒ dọn artifact phải xoá cả link (CASCADE).
  await o`insert into hub.artifact_runs (tenant_id, run_id, key)
    select tenant_id, ${RUN}::uuid, key from hub.artifacts where tenant_id in (${T.a}, ${T.b})`;
  db = createDb(urls().hubApi, { max: 2 });
  db2 = createDb(urls().hubApi, { max: 2 });
}, 300_000);
afterAll(async () => {
  await db?.close();
  await db2?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-114 · dọn artifact hết hạn", () => {
  it("theo lô, an toàn khi hai Hub dọn cùng lúc", async () => {
    const [r1, r2] = await Promise.all([
      sweepArtifactsOnce({ db, now: NOW, batch: 10, maxBatches: 2 }),
      sweepArtifactsOnce({ db: db2, now: NOW, batch: 10, maxBatches: 2 }),
    ]);
    // Mỗi lượt ≤ batch × maxBatches = 20; tổng hai lượt ≤ 25 và không xoá trùng.
    expect(r1.deleted).toBeLessThanOrEqual(20);
    expect(r2.deleted).toBeLessThanOrEqual(20);
    const rest = await sweepArtifactsOnce({ db, now: NOW, batch: 10, maxBatches: 2 });
    expect(r1.deleted + r2.deleted + rest.deleted).toBe(25);
    expect(rest.skipped).toBe(false);
    const left = await o<{ key: string }[]>`select key from hub.artifacts
      where tenant_id in (${T.a}, ${T.b}) order by key`;
    expect(left.map((r) => r.key)).toEqual([hex(26), hex(27), hex(28)]);
    const links = await o<{ key: string }[]>`select key from hub.artifact_runs
      where tenant_id in (${T.a}, ${T.b}) order by key`;
    expect(links.map((r) => r.key)).toEqual([hex(26), hex(27), hex(28)]);
  });
});
