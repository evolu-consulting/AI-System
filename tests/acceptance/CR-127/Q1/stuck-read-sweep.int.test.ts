// CR-127 · Q1e · spec §3 (#2 draft/reading → draft/failed STALE) · viết lại AC mất phủ khi gỡ HD3/sweep: lượt AI đọc kẹt (`extract_state='reading'`
// quá hạn) được vòng quét chuyển `failed` (HĐ giữ Nháp, ghi `extract_failed STALE`, lượt đọc `failed`); chưa quá hạn / HĐ không còn đang đọc ⇒ không
// chạm; chạy lại không đổi thêm. Không ngủ chờ: hạn tính bằng `updated_at`/`queued_at` dựng lùi giờ, gọi thẳng `sweepRepo` (MỘT câu).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { approvalRepo } from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/approval.repo";
import { sweepRepo } from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/approval-sweep.repo";
import { createPackUow } from "../../../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";

let sql: Sql;
let db: Db;
let T = "";
let A = "";
let ids: string[] = [];
beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [T] = (await tenants(sql, 1, 1271)) as [string];
  [A] = (await users(sql, T, 1, { from: 1271 })) as [string];
  ids = await contracts(sql, T, 6, { from: 1271, createdBy: A, status: "draft" });
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const sweep = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    sweep: sweepRepo(tx, tid),
  })).system(T, (r) => r.sweep.sweep({ staleMinutes: 15, queuedMinutes: 360, limit: 500 }));
const ago = (m: number) => new Date(Date.now() - m * 60_000);

async function seed(i: number, o: { state: string; ago: number; run?: "extracting" | null }) {
  const id = ids[i] as string;
  const aid = crypto.randomUUID();
  if (o.run)
    await sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, queued_at)
      values (${aid}, ${T}, ${id}, ${o.run}, ${A}, null)`;
  await sql`update contracts.contracts set extract_state = ${o.state}, run_id = ${o.run ? aid : null},
    updated_at = ${ago(o.ago)} where id = ${id}`;
  return { id, aid };
}
const row = async (id: string) =>
  (
    await sql<
      { status: string; extract_state: string; error: string | null }[]
    >`select status, extract_state, error from contracts.contracts where id = ${id}`
  )[0];

describe("CR-127 Q1e · vòng quét lượt đọc AI kẹt", () => {
  it("Q1-AC5a · reading quá hạn (20') ⇒ failed STALE, vẫn Nháp, lượt đọc failed, có sự kiện extract_failed; chạy lại closed = 0", async () => {
    const k = await seed(0, { state: "reading", ago: 20, run: "extracting" });
    const s = await sweep();
    expect(s.closed).toBe(1);
    expect(await row(k.id)).toEqual({ status: "draft", extract_state: "failed", error: "STALE" });
    const [a] = await sql<
      { status: string }[]
    >`select status from contracts.approvals where id = ${k.aid}`;
    expect(a?.status).toBe("failed");
    const [e] = await sql<
      { n: number; code: string | null }[]
    >`select count(*)::int as n, max(data->>'code') as code
      from contracts.contract_events where contract_id = ${k.id} and type = 'extract_failed'`;
    expect(e).toEqual({ n: 1, code: "STALE" });
    expect((await sweep()).closed).toBe(0);
  });

  it("Q1-AC5b · reading chưa quá hạn (2') ⇒ giữ nguyên; HĐ ready / failed sẵn không bị chạm", async () => {
    const fresh = await seed(1, { state: "reading", ago: 2, run: "extracting" });
    const ready = await seed(2, { state: "ready", ago: 500 });
    const failed = await seed(3, { state: "failed", ago: 500 });
    await sql`update contracts.contracts set error = 'AI_DOWN' where id = ${failed.id}`;
    expect((await sweep()).closed).toBe(0);
    expect(await row(fresh.id)).toEqual({ status: "draft", extract_state: "reading", error: null });
    expect((await row(ready.id))?.extract_state).toBe("ready");
    expect(await row(failed.id)).toEqual({
      status: "draft",
      extract_state: "failed",
      error: "AI_DOWN",
    });
  });

  it("Q1-AC5c · quét tenant T không đổi HĐ reading quá hạn của tenant khác", async () => {
    const [other] = (await tenants(sql, 1, 1281)) as [string];
    const [u] = (await users(sql, other, 1, { from: 1281 })) as [string];
    const [oid] = await contracts(sql, other, 1, { from: 1281, createdBy: u, status: "draft" });
    await sql`update contracts.contracts set extract_state = 'reading', updated_at = ${ago(600)} where id = ${oid as string}`;
    await sweep();
    expect((await row(oid as string))?.extract_state).toBe("reading");
  });
});
