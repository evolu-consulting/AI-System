// CR-132 M3 · HD-MSG-01..12 · Luật 4c · đo đường nóng tin nhắn (spec §6) trên DB thật: 1 người trong 200 hội thoại (nhóm 50 người), 100.000 tin, một nửa chưa đọc.
// (1) số câu SQL mỗi thao tác CỐ ĐỊNH (đếm ở `tx.execute`, không phụ thuộc số hàng); (2) p95 theo ngưỡng spec. In số thật ra console (trước → sau ghi ở tasks.md).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { internalUsersAmong } from "../../kit/adapters/member-names";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import type { MessagesRepos } from "./application/messages.ports";
import { messagesUsecases } from "./application/messages.usecase";

const CONVS = 200;
const PER_CONV = 500; // 200 × 500 = 100.000 tin
const GROUP = 50;
const RUNS = 40;

let o: Sql;
let db: Db;
let T = "";
let P = "";
let statements = 0;
const cids = Array.from(
  { length: CONVS },
  (_, i) => `c1320000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);

const counting = (tx: Tx): Tx =>
  new Proxy(tx, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k !== "execute") return v;
      return (...a: unknown[]) => {
        statements++;
        return (v as (...x: unknown[]) => unknown).apply(t, a);
      };
    },
  });
const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    messages: messagesRepo(counting(tx), t),
  })) as never as PackUow<MessagesRepos>;
const uc = () =>
  messagesUsecases({ uow: uow(), people: internalUsersAmong(db), newId: () => Bun.randomUUIDv7() });
const w = () => ({ tenantId: T, userId: P });

async function measure(
  name: string,
  fn: () => Promise<unknown>,
): Promise<{ p95: number; sql: number }> {
  await fn(); // làm nóng kết nối/chuẩn bị câu
  const ms: number[] = [];
  statements = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  const per = statements / RUNS;
  ms.sort((a, b) => a - b);
  const p95 = ms[Math.ceil(RUNS * 0.95) - 1] ?? 0;
  console.log(
    `[perf CR-132 M3] ${name}: p95 ${p95.toFixed(1)} ms · ${per} câu SQL repo / thao tác`,
  );
  return { p95, sql: per };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  [T] = (await tenants(o, 1, 9381)) as [string];
  const [u] = (await users(o, T, 1, { from: 9381 })) as [string];
  P = u as string;
  const others = (await users(o, T, GROUP - 1, { from: 9390 })) as string[];
  await o`insert into contracts.msg_conversations (tenant_id, id, kind, title, created_by, last_seq, last_at)
    select ${T}::uuid, c::uuid, 'group', 'Nhóm ' || i, ${P}::uuid, ${PER_CONV}, now() - (i || ' minutes')::interval
    from unnest(${cids}::text[]) with ordinality as x(c, i)`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role, last_read_seq)
    select ${T}::uuid, c::uuid, ${P}::uuid, 'owner', ${PER_CONV / 2} from unnest(${cids}::text[]) as c`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id)
    select ${T}::uuid, c::uuid, m::uuid from unnest(${cids}::text[]) as c cross join unnest(${others}::text[]) as m`;
  await o`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
    select ${T}::uuid, c::uuid, s, case when s % 2 = 0 then ${P}::uuid else ${others[0] as string}::uuid end, gen_random_uuid(), 'tin số ' || s
    from unnest(${cids}::text[]) as c cross join generate_series(1, ${PER_CONV}) as s`;
  await o`analyze contracts.msg_messages`;
  await o`analyze contracts.msg_members`;
  await o`analyze contracts.msg_conversations`;
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-132 M3 · perf tin nhắn (200 hội thoại × 500 tin = 100.000 tin, nhóm 50 người)", () => {
  it("chưa đọc tổng: 1 câu, p95 ≤ 20 ms, đúng số (kẹp 999)", async () => {
    const r = await measure("GET /messages/unread", () => uc().unread(w()));
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(20);
    expect((await uc().unread(w())).total).toBe(999); // 200 × 125 chưa đọc, trần 999
  });

  it("danh sách 30 hội thoại: 1 câu repo (+1 tra tên), p95 ≤ 50 ms", async () => {
    const r = await measure("GET /messages/conversations (30)", () =>
      uc().list(w(), { cursor: null, limit: 30 }),
    );
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(50);
    const page = await uc().list(w(), { cursor: null, limit: 30 });
    expect(page.items).toHaveLength(30);
    expect(page.next_cursor).not.toBeNull();
    expect(page.items[0]?.unread).toBe(99);
  });

  it("50 tin gần nhất: 1 câu, p95 ≤ 30 ms", async () => {
    const r = await measure("GET …/messages (50)", () =>
      uc().messages(w(), cids[0] as string, { limit: 50 }),
    );
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(30);
  });

  it("gửi tin: 2 câu cố định (kiểm hội thoại + CTE gửi), p95 ≤ 40 ms", async () => {
    const r = await measure("POST …/messages", () =>
      uc().send(w(), cids[1] as string, {
        client_id: Bun.randomUUIDv7(),
        body: "đo",
        file_ids: [],
      }),
    );
    expect(r.sql).toBe(2);
    expect(r.p95).toBeLessThanOrEqual(40);
  });

  it("đánh dấu đã đọc: 2 câu (cập nhật + tổng), p95 ≤ 20 ms", async () => {
    const r = await measure("POST …/read", () => uc().markRead(w(), cids[2] as string, PER_CONV));
    expect(r.sql).toBe(2);
    expect(r.p95).toBeLessThanOrEqual(20);
  });
});
