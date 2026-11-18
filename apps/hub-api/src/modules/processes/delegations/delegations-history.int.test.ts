// CR-184 · lịch sử uỷ quyền (DB thật, role `hub_api`): ai vắng → giao ai, ai đặt, trạng thái (còn hiệu lực / hết hạn / đã thu hồi + ai thu hồi),
// số việc người được giao đã làm thay, danh sách việc, phạm vi xem (người thường: có mình; quản trị: cả công ty), tải dần (next_offset).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { type ClaimWorld, claimWorld, groupTask } from "../testing/claim-seed";
import { DelegationsService } from "./delegations.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;
const DAY = 86_400_000;
const who = (userId: string, role: "member" | "tenant_admin" = "member") =>
  ({ userId, tenantId: w.T, role }) as never;
const svc = () => new DelegationsService({ db } as unknown as ProcessDeps);
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Hàng uỷ quyền A → B (chèn thẳng, đủ cột lịch sử). */
async function put(o2: {
  from: string;
  to: string;
  a: number;
  b: number;
  createdBy?: string;
  revoked?: { by: string };
}) {
  const [d] = await o<{ id: string }[]>`insert into hub.delegations
      (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by, revoked_at, revoked_by)
    values (${w.T}, ${o2.from}, ${o2.to}, ${iso(o2.a * DAY)}::timestamptz, ${iso(o2.b * DAY)}::timestamptz, '{approve}'::text[],
      ${o2.createdBy ?? o2.from}, ${o2.revoked ? iso(0) : null}::timestamptz, ${o2.revoked?.by ?? null})
    returning id::text as id`;
  return d?.id as string;
}
/** Một việc đã đóng do `to` quyết trong khoảng, có hàng giao việc `delegated` thay `from`. */
async function doneTask(from: string, to: string) {
  const s = await groupTask(o, w, w.G);
  await o`update hub.review_tasks set status = 'closed', result = 'pass', decided_by = ${to}, decided_at = now() where id = ${s.taskId}`;
  await o`delete from hub.review_task_assignees where task_id = ${s.taskId}`;
  await o`insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth, on_behalf_of)
    values (${w.T}, ${s.taskId}, ${to}, 'delegated', 0, ${from})`;
  return s.taskId;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  w = await claimWorld(o, 9881);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-184 · lịch sử uỷ quyền", () => {
  it("trạng thái, người đặt thay, người thu hồi, số việc đã làm thay; hết hạn / thu hồi vẫn nằm trong lịch sử", async () => {
    await o`delete from hub.delegations where tenant_id = ${w.T}`;
    const live = await put({ from: w.A, to: w.B, a: -1, b: 3, createdBy: w.TA });
    const old = await put({ from: w.A, to: w.X, a: -9, b: -5 });
    const rev = await put({ from: w.H, to: w.X, a: -1, b: 3, revoked: { by: w.TA } });
    await doneTask(w.A, w.B);
    await doneTask(w.A, w.B);
    const r = await svc().history(who(w.TA, "tenant_admin"), { mine: false, limit: 20, offset: 0 });
    const by = new Map(r.items.map((i) => [i.id, i]));
    expect(by.get(live)).toMatchObject({
      status: "active",
      done_count: 2,
      created_by: { id: w.TA },
      from_user: { id: w.A },
      to_user: { id: w.B },
    });
    expect(by.get(old)).toMatchObject({ status: "expired", done_count: 0 });
    expect(by.get(rev)).toMatchObject({ status: "revoked", revoked_by: { id: w.TA } });
    expect(by.get(rev)?.revoked_at).not.toBeNull();
    expect(r.next_offset).toBeNull();
  });

  it("phạm vi xem: người thường chỉ thấy uỷ quyền có mình; quản trị thấy cả công ty; người ngoài không thấy gì", async () => {
    const mine = await svc().history(who(w.B), { mine: true, limit: 20, offset: 0 });
    expect(mine.items.every((i) => i.from_user.id === w.B || i.to_user.id === w.B)).toBe(true);
    expect(mine.items.length).toBeGreaterThan(0);
    const out = await svc().history(who(w.S), { mine: true, limit: 20, offset: 0 });
    expect(out.items).toEqual([]);
    const all = await svc().history(who(w.TA, "tenant_admin"), {
      mine: false,
      limit: 20,
      offset: 0,
    });
    expect(all.items.length).toBe(3);
  });

  it("tải dần: limit 2 ⇒ next_offset 2, trang sau hết", async () => {
    const p1 = await svc().history(who(w.TA, "tenant_admin"), { mine: false, limit: 2, offset: 0 });
    expect(p1.items.length).toBe(2);
    expect(p1.next_offset).toBe(2);
    const p2 = await svc().history(who(w.TA, "tenant_admin"), { mine: false, limit: 2, offset: 2 });
    expect(p2.items.length).toBe(1);
    expect(p2.next_offset).toBeNull();
  });

  it("danh sách việc làm thay + người không liên quan bị 404; thu hồi ghi người thu hồi", async () => {
    const [d] = await o<{ id: string }[]>`select id::text as id from hub.delegations
      where tenant_id = ${w.T} and from_user_id = ${w.A} and to_user_id = ${w.B}`;
    const work = await svc().work(who(w.B), d?.id as string, { limit: 20, offset: 0 });
    expect(work.items.length).toBe(2);
    expect(work.items[0]?.kind).toBe("review");
    await expect(svc().work(who(w.S), d?.id as string, { limit: 20, offset: 0 })).rejects.toThrow();
    // A tự thu hồi ⇒ revoked_by = A
    await svc().revoke(who(w.A), d?.id as string);
    const h = await svc().history(who(w.A), { mine: true, limit: 20, offset: 0 });
    expect(h.items.find((i) => i.id === d?.id)).toMatchObject({
      status: "revoked",
      revoked_by: { id: w.A },
    });
  });
});
