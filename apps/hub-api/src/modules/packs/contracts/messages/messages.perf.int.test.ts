// CR-132 M3 · HD-MSG-01..12 · Luật 4c · đo đường nóng tin nhắn (spec §6) trên DB thật: 1 người trong 200 hội thoại (nhóm 50 người), 100.000 tin, một nửa chưa đọc.
// CR-169 lát 3a: thêm nguồn `partner` — 200 cuộc `pmsg_*` với 200 người của 20 công ty đã kết nối, 100.000 tin ⇒ danh sách/chưa đọc là HỢP NHẤT hai nguồn (vẫn 1 câu).
// (1) số câu SQL mỗi thao tác CỐ ĐỊNH (đếm ở `tx.execute`, không phụ thuộc số hàng); (2) p95 theo ngưỡng spec. In số thật ra console (trước → sau ghi ở tasks.md).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { enablePack, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { internalUsersAmong } from "../../kit/adapters/member-names";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import { partnerRepo } from "./adapters/partner.repo";
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
    partner: partnerRepo(counting(tx)),
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
  await seedPartner();
  await o`analyze contracts.msg_messages`;
  await o`analyze contracts.msg_members`;
  await o`analyze contracts.msg_conversations`;
  await o`analyze hub.pmsg_threads`;
  await o`analyze hub.pmsg_messages`;
}, 300_000);

/** CR-169: P (có quyền Sổ Hợp Tác) kết nối 20 công ty × 10 người = 200 cuộc `partner` × 500 tin (P đọc tới nửa chừng), xen kẽ về thời gian với 200 cuộc nhóm. */
async function seedPartner(): Promise<void> {
  const peers = (await tenants(o, 20, 9500)) as string[];
  const g = await enablePack(o, [T, ...peers], "contracts");
  await members(o, T, g.get(T)?.viewer as string, [P]);
  for (const [k, pt] of peers.entries()) {
    const us = (await users(o, pt, 10, { from: 9600 + k * 10 })) as string[];
    await members(o, pt, g.get(pt)?.viewer as string, us);
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    select ${T}::uuid, p::uuid, now() from unnest(${peers}::text[]) p
    union all select p::uuid, ${T}::uuid, now() from unnest(${peers}::text[]) p`;
  await o`insert into hub.pmsg_threads (id, a_tenant, a_user, b_tenant, b_user, last_seq, last_at, a_read_seq, b_read_seq)
    select x.id, case when x.p_first then ${T}::uuid else x.pt end, case when x.p_first then ${P}::uuid else x.pu end,
           case when x.p_first then x.pt else ${T}::uuid end, case when x.p_first then x.pu else ${P}::uuid end,
           ${PER_CONV}, now() - ((x.i + 0.5) || ' minutes')::interval,
           case when x.p_first then ${PER_CONV / 2} else ${PER_CONV} end, case when x.p_first then ${PER_CONV} else ${PER_CONV / 2} end
      from (select gen_random_uuid() as id, u.tenant_id as pt, u.id as pu, row_number() over (order by u.id) as i,
                   (${T}::uuid, ${P}::uuid) < (u.tenant_id, u.id) as p_first
              from admin.users u where u.tenant_id = any(${peers}::uuid[])) x`;
  await o`insert into hub.pmsg_messages (thread_id, seq, sender_user, body, client_id)
    select t.id, s, case when s % 2 = 0 then ${P}::uuid else (case when t.a_user = ${P}::uuid then t.b_user else t.a_user end) end, 'tin số ' || s, gen_random_uuid()
      from hub.pmsg_threads t cross join generate_series(1, ${PER_CONV}) as s`;
}
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-132 M3 · perf tin nhắn (200 hội thoại × 500 tin = 100.000 tin, nhóm 50 người)", () => {
  it("chưa đọc tổng: 1 câu, p95 ≤ 20 ms, đúng số (kẹp 999)", async () => {
    const r = await measure("GET /messages/unread", () => uc().unread(w()));
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(20);
    expect((await uc().unread(w())).total).toBe(999); // (200 nhóm + 200 partner) × 125 chưa đọc, trần 999
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
    expect(page.items[0]?.unread).toBe(100);
    // CR-169: hai nguồn xen kẽ theo thời gian (nhóm i phút, partner i + 0,5 phút) ⇒ trang 30 chứa cả hai loại, mới nhất trước.
    expect(new Set(page.items.map((x) => x.kind))).toEqual(new Set(["group", "partner"]));
    const at = page.items.map((x) => x.last_at);
    expect(at).toEqual([...at].sort().reverse());
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
