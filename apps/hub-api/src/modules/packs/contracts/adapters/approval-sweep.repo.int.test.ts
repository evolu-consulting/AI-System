// M3c · review B #7/#12/#26 · SQL flow duyệt trên DB thật (pool hub_api, role contracts_rw, RLS gói):
// (1) #7 job còn XẾP HÀNG (`queued_at`) không bị STALE 15' — chỉ đóng khi chờ quá `queuedMinutes`; job đã chạy tính từ
//     `updated_at` (worker chạm lúc bắt đầu, `markStarted`); hạn chạy luôn > `claimIdleMs` (`staleMinutesFor`);
// (2) #12 lượt `extracting` mà HĐ đã xong lượt đọc ⇒ quét ⇒ `level1`/`failed` (healed);
// (3) #26 `finalize(level2Passed=true)` tự kiểm lượt ở `level2` và người quyết ≠ người bắt đầu (caller nói dối ⇒ 0 hàng).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { staleMinutesFor } from "../application/approval-sweep";
import { approvalRepo } from "./approval.repo";
import { sweepRepo } from "./approval-sweep.repo";

let sql: Sql;
let db: Db;
let T = "";
let A = "";
let B = "";
let ids: string[] = [];

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [T] = (await tenants(sql, 1, 871)) as [string];
  [A, B] = (await users(sql, T, 2, { from: 871 })) as [string, string];
  ids = await contracts(sql, T, 8, { from: 871, createdBy: A, status: "extracting" });
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    sweep: sweepRepo(tx, tid),
  }));
const sweep = () =>
  uow().system(T, (r) => r.sweep.sweep({ staleMinutes: 15, queuedMinutes: 360, limit: 500 }));
const mins = (n: number) => new Date(Date.now() - n * 60_000);

/** HĐ `i` ở trạng thái `status` (cập nhật `ago` phút trước) + lượt `aStatus` (`queuedAgo` null ⇒ đã chạy). */
async function seed(
  i: number,
  o: { status: string; ago: number; aStatus: string; queuedAgo: number | null; by?: string },
) {
  const id = ids[i] as string;
  const aid = crypto.randomUUID();
  await sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, queued_at)
    values (${aid}, ${T}, ${id}, ${o.aStatus}, ${o.by ?? A},
      ${o.queuedAgo === null ? null : mins(o.queuedAgo)})`;
  await sql`update contracts.contracts set status = ${o.status}, run_id = ${aid}, updated_at = ${mins(o.ago)},
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 900000000))
    where id = ${id}`;
  return { id, aid };
}
const row = async (id: string) =>
  (
    await sql<{ status: string; error: string | null }[]>`select status, error
    from contracts.contracts where id = ${id}`
  )[0];
const aRow = async (aid: string) =>
  (
    await sql<{ status: string; queued_at: Date | null }[]>`select status, queued_at
    from contracts.approvals where id = ${aid}`
  )[0];

describe("M3c · STALE chỉ cho job đang chạy thật sự quá hạn [review B #7]", () => {
  it("xếp hàng 20' ⇒ giữ; xếp hàng 7 giờ ⇒ STALE; đã chạy 2' ⇒ giữ; đã chạy 20' ⇒ STALE", async () => {
    const q20 = await seed(0, {
      status: "extracting",
      ago: 20,
      aStatus: "extracting",
      queuedAgo: 20,
    });
    const q7h = await seed(1, {
      status: "extracting",
      ago: 420,
      aStatus: "extracting",
      queuedAgo: 420,
    });
    const r2 = await seed(2, {
      status: "extracting",
      ago: 2,
      aStatus: "extracting",
      queuedAgo: null,
    });
    const r20 = await seed(3, {
      status: "extracting",
      ago: 20,
      aStatus: "extracting",
      queuedAgo: null,
    });
    const s = await sweep();
    expect(s.closed).toBe(2);
    expect(await row(q20.id)).toEqual({ status: "extracting", error: null });
    expect(await row(q7h.id)).toEqual({ status: "extract_failed", error: "STALE" });
    expect(await row(r2.id)).toEqual({ status: "extracting", error: null });
    expect(await row(r20.id)).toEqual({ status: "extract_failed", error: "STALE" });
    expect((await aRow(q7h.aid))?.status).toBe("failed");
    expect((await sweep()).closed).toBe(0);
  });
});

describe("M3c · worker bắt đầu lượt đọc ⇒ hết xếp hàng [review B #7]", () => {
  it("markStarted: lượt hết xếp hàng + HĐ updated_at = now ⇒ hạn tính từ lúc chạy; lượt không còn extracting ⇒ false", async () => {
    const q = await seed(4, {
      status: "extracting",
      ago: 30,
      aStatus: "extracting",
      queuedAgo: 30,
    });
    const who = { tenantId: T, userId: A };
    expect(await uow().tenant(who, (r) => r.approval.markStarted(q.id, q.aid))).toBe(true);
    expect((await aRow(q.aid))?.queued_at).toBeNull();
    expect((await sweep()).closed).toBe(0); // vừa bắt đầu ⇒ chưa quá hạn
    await sql`update contracts.approvals set status = 'failed' where id = ${q.aid}`;
    expect(await uow().tenant(who, (r) => r.approval.markStarted(q.id, q.aid))).toBe(false);
  });

  it("hạn job đang chạy ≥ claimIdleMs + 5' (timeout 3600 s ⇒ 66'); mặc định 15'", () => {
    expect(staleMinutesFor(3_660_000)).toBe(66);
    expect(staleMinutesFor(360_000)).toBe(15);
  });
});

describe("M3c · lượt kẹt extracting khi HĐ đã xong lượt đọc [review B #12]", () => {
  it("HĐ needs_review + lượt extracting ⇒ quét ⇒ lượt level1 (healed = 1), lượt 2 không đổi", async () => {
    const h = await seed(5, {
      status: "needs_review",
      ago: 1,
      aStatus: "extracting",
      queuedAgo: null,
    });
    expect((await sweep()).healed).toBe(1);
    expect((await aRow(h.aid))?.status).toBe("level1");
    expect((await sweep()).healed).toBe(0);
  });
});

describe("M3c · finalize tự kiểm cấp 2 [review B #26]", () => {
  it("level2Passed=true nhưng lượt ở level1 / người bắt đầu tự duyệt ⇒ 0 hàng; level2 + người khác ⇒ active", async () => {
    const l1 = await seed(6, {
      status: "needs_review",
      ago: 1,
      aStatus: "level1",
      queuedAgo: null,
    });
    const fin = (id: string, aid: string, by: string) =>
      uow().tenant({ tenantId: T, userId: by }, (r) => r.approval.finalize(id, aid, by, true));
    expect(await fin(l1.id, l1.aid, B)).toBe(false);
    const l2 = await seed(7, {
      status: "needs_review",
      ago: 1,
      aStatus: "level2",
      queuedAgo: null,
    });
    expect(await fin(l2.id, l2.aid, A)).toBe(false); // A là người bắt đầu
    expect(await fin(l2.id, l2.aid, B)).toBe(true);
    expect((await row(l2.id))?.status).toBe("active");
    expect((await aRow(l2.aid))?.status).toBe("done");
  });
});
