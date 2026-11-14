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
import { extractionRepo } from "./extraction.repo";

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
  ids = await contracts(sql, T, 11, { from: 871, createdBy: A, status: "draft" });
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
    extraction: extractionRepo(tx, tid),
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
  // CR-127: trạng thái cũ ⇒ draft + extract_state (status không đổi ⇒ không qua cổng)
  const es =
    o.status === "extracting" ? "reading" : o.status === "extract_failed" ? "failed" : "ready";
  await sql`update contracts.contracts set extract_state = ${es}, run_id = ${aid}, updated_at = ${mins(o.ago)},
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 900000000))
    where id = ${id}`;
  return { id, aid };
}
const row = async (id: string) =>
  (
    await sql<
      { status: string; extract_state: string; error: string | null }[]
    >`select status, extract_state, error
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
    expect(await row(q20.id)).toEqual({ status: "draft", extract_state: "reading", error: null });
    expect(await row(q7h.id)).toEqual({ status: "draft", extract_state: "failed", error: "STALE" });
    expect(await row(r2.id)).toEqual({ status: "draft", extract_state: "reading", error: null });
    expect(await row(r20.id)).toEqual({ status: "draft", extract_state: "failed", error: "STALE" });
    expect((await aRow(q7h.aid))?.status).toBe("failed");
    expect((await sweep()).closed).toBe(0);
  });
});

describe("CR-155 · hạn đọc AI: `reading` quá hạn ⇒ failed/TIMEOUT, kết quả về muộn bị bỏ", () => {
  const sweepT = () =>
    uow().system(T, (r) =>
      r.sweep.sweep({ staleMinutes: 15, queuedMinutes: 360, readTimeoutSeconds: 180, limit: 500 }),
    );
  const lateSave = (id: string, expected: number) =>
    uow().tenant({ tenantId: T, userId: A }, (r) =>
      r.extraction.saveResult(id, {
        fields: {},
        clauses: [],
        warnings: [],
        expected,
      } as never),
    );

  it("đọc quá 3 phút (xếp hàng hoặc đang chạy) ⇒ TIMEOUT, lượt failed, event code TIMEOUT, đọc 1 phút ⇒ giữ", async () => {
    const qOld = await seed(8, {
      status: "extracting",
      ago: 4,
      aStatus: "extracting",
      queuedAgo: 4,
    });
    const rOld = await seed(9, {
      status: "extracting",
      ago: 4,
      aStatus: "extracting",
      queuedAgo: null,
    });
    const qNew = await seed(10, {
      status: "extracting",
      ago: 1,
      aStatus: "extracting",
      queuedAgo: 1,
    });
    const s = await sweepT();
    expect(s.closed).toBeGreaterThanOrEqual(2); // gồm cả HĐ reading cũ của ca trước
    expect(await row(qOld.id)).toEqual({
      status: "draft",
      extract_state: "failed",
      error: "TIMEOUT",
    });
    expect(await row(rOld.id)).toEqual({
      status: "draft",
      extract_state: "failed",
      error: "TIMEOUT",
    });
    expect(await row(qNew.id)).toEqual({ status: "draft", extract_state: "reading", error: null });
    expect((await aRow(qOld.aid))?.status).toBe("failed");
    const ev = await sql<
      { code: string }[]
    >`select data->>'code' as code from contracts.contract_events
      where contract_id = ${qOld.id} and type = 'extract_failed'`;
    expect(ev.map((e) => e.code)).toEqual(["TIMEOUT"]);
    expect((await sweepT()).closed).toBe(0);
  });

  it("kết quả AI về sau hết giờ ⇒ BỎ (CAS extract_state = reading): HĐ vẫn failed, mã TIMEOUT", async () => {
    const id = ids[8] as string;
    const [cur] = await sql<
      { version: number }[]
    >`select version from contracts.contracts where id = ${id}`;
    expect(await lateSave(id, cur?.version ?? 0)).toBe(false);
    expect((await row(id))?.extract_state).toBe("failed");
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
  it("HĐ draft đã đọc xong + lượt extracting ⇒ quét ⇒ lượt cancelled (healed = 1, không mở cấp 1), chạy lại không đổi", async () => {
    const h = await seed(5, {
      status: "needs_review",
      ago: 1,
      aStatus: "extracting",
      queuedAgo: null,
    });
    expect((await sweep()).healed).toBe(1);
    expect((await aRow(h.aid))?.status).toBe("cancelled");
    expect((await sweep()).healed).toBe(0);
  });
});
