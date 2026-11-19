// CR-190 · lát `cr190-msg-directory-api` · Luật 4c · đo danh bạ nhóm `GET /messages/directory` trên DB thật: công ty người gọi 1.000 đồng nghiệp, 4 công ty đối tác kết nối × 1.000 người đủ điều kiện,
// 400 cuộc đối tác + 100 cuộc 1-1 + 20 nhóm (mỗi cuộc 20 tin, một nửa chưa đọc). (1) số câu SQL mỗi yêu cầu CỐ ĐỊNH (không theo số nhóm/dòng/limit); (2) p95 theo ngưỡng; in số thật ra console.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { enablePack, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { internalDirectoryPeople } from "../../kit/adapters/directory-people";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import { partnerRepo } from "./adapters/partner.repo";
import type { MessagesRepos } from "./application/messages.ports";
import { messagesUsecases } from "./application/messages.usecase";

const PEERS = 4;
const PER = 1000;
const THREADS_PER_COMPANY = 100;
const DMS = 100;
const GROUPS = 20;
const MSGS = 20;
const RUNS = 30;

let o: Sql;
let db: Db;
let T = "";
let P = "";
let peers: string[] = [];
let statements = 0;

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
    partner: partnerRepo(counting(tx), t),
  })) as never as PackUow<MessagesRepos>;
const uc = () => {
  const dirPeople = internalDirectoryPeople(db);
  return messagesUsecases({
    uow: uow(),
    people: async () => new Map(),
    dirPeople: async (who, ids) => {
      statements += 2; // hàm tra đồng nghiệp: 2 câu trong MỘT kết nối hub
      return dirPeople(who, ids);
    },
    newId: () => Bun.randomUUIDv7(),
  });
};
const w = () => ({ tenantId: T, userId: P, userKind: "internal" as const });
const q = (extra: { group?: string; cursor?: string; q?: string; limit?: number } = {}) => ({
  limit: 15,
  ...extra,
});

async function measure(
  name: string,
  fn: () => Promise<unknown>,
): Promise<{ p95: number; sql: number }> {
  await fn();
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
    `[perf CR-190 directory] ${name}: p95 ${p95.toFixed(1)} ms · ${per} câu SQL / yêu cầu`,
  );
  return { p95, sql: per };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  [T] = (await tenants(o, 1, 9701)) as [string];
  const mine = (await users(o, T, PER, { from: 970000 })) as string[];
  P = mine[0] as string;
  peers = (await tenants(o, PEERS, 9710)) as string[];
  const g = await enablePack(o, [T, ...peers], "contracts");
  await members(o, T, g.get(T)?.viewer as string, [P]);
  for (const [k, pt] of peers.entries()) {
    const us = (await users(o, pt, PER, { from: 980000 + k * PER })) as string[];
    await members(o, pt, g.get(pt)?.viewer as string, us);
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    select ${T}::uuid, p::uuid, now() from unnest(${peers}::text[]) p
    union all select p::uuid, ${T}::uuid, now() from unnest(${peers}::text[]) p`;
  // 100 cuộc đối tác mỗi công ty (người đầu tiên theo id), 20 tin, người gọi đọc tới nửa chừng.
  await o`insert into hub.pmsg_threads (id, a_tenant, a_user, b_tenant, b_user, last_seq, last_at, a_read_seq, b_read_seq)
    select x.id, case when x.p_first then ${T}::uuid else x.pt end, case when x.p_first then ${P}::uuid else x.pu end,
           case when x.p_first then x.pt else ${T}::uuid end, case when x.p_first then x.pu else ${P}::uuid end,
           ${MSGS}::bigint, now() - ((x.i + 0.5) || ' minutes')::interval,
           case when x.p_first then ${MSGS / 2}::bigint else ${MSGS}::bigint end, case when x.p_first then ${MSGS}::bigint else ${MSGS / 2}::bigint end
      from (select gen_random_uuid() as id, u.tenant_id as pt, u.id as pu, row_number() over (order by u.id) as i,
                   (${T}::uuid, ${P}::uuid) < (u.tenant_id, u.id) as p_first
              from (select u.*, row_number() over (partition by u.tenant_id order by u.id) as r from admin.users u where u.tenant_id = any(${peers}::uuid[])) u
             where u.r <= ${THREADS_PER_COMPANY}) x`;
  await o`insert into hub.pmsg_messages (thread_id, seq, sender_user, body, client_id)
    select t.id, s, case when s % 2 = 0 then ${P}::uuid else (case when t.a_user = ${P}::uuid then t.b_user else t.a_user end) end, 'tin số ' || s, gen_random_uuid()
      from hub.pmsg_threads t cross join generate_series(1, ${MSGS}::int) as s`;
  // 100 cuộc 1-1 + 20 nhóm nội bộ.
  const cids = Array.from(
    { length: DMS + GROUPS },
    (_, i) => `c1970000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  const others = mine.slice(1, DMS + 1);
  await o`insert into contracts.msg_conversations (tenant_id, id, kind, title, dm_key, created_by, last_seq, last_at)
    select ${T}::uuid, c::uuid, case when i <= ${DMS} then 'direct' else 'group' end, case when i <= ${DMS} then null else 'Nhóm ' || i end,
      case when i <= ${DMS} then least(${P}::text, (${others}::text[])[i::int]) || ':' || greatest(${P}::text, (${others}::text[])[i::int]) else null end,
      ${P}::uuid, ${MSGS}, now() - (i || ' minutes')::interval
    from unnest(${cids}::text[]) with ordinality as x(c, i)`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role, last_read_seq)
    select ${T}::uuid, c::uuid, ${P}::uuid, 'owner', ${MSGS / 2} from unnest(${cids}::text[]) as c`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, last_read_seq)
    select ${T}::uuid, c::uuid, (${others}::text[])[i::int]::uuid, ${MSGS} from unnest(${cids.slice(0, DMS)}::text[]) with ordinality as x(c, i)`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, last_read_seq)
    select ${T}::uuid, c::uuid, m::uuid, ${MSGS} from unnest(${cids.slice(DMS)}::text[]) as c cross join unnest(${others.slice(0, 20)}::text[]) as m`;
  await o`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
    select ${T}::uuid, c::uuid, s, case when s % 2 = 0 then ${P}::uuid else ${others[0] as string}::uuid end, gen_random_uuid(), 'tin số ' || s
    from unnest(${cids}::text[]) as c cross join generate_series(1, ${MSGS}) as s`;
  for (const t of [
    "admin.users",
    "admin.group_members",
    "admin.feature_grants",
    "hub.pmsg_threads",
    "hub.pmsg_messages",
    "contracts.msg_messages",
    "contracts.msg_members",
  ])
    await o.unsafe(`analyze ${t}`);
}, 600_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-190 · perf danh bạ nhóm (4 công ty × 1.000 người + 1.000 đồng nghiệp)", () => {
  it("mọi nhóm, 15 dòng đầu: số câu cố định (không theo số nhóm/limit), p95 ≤ ngưỡng, đúng tổng người", async () => {
    const r = await measure("GET /messages/directory (mọi nhóm, 15)", () =>
      uc().directory(w(), q()),
    );
    expect(r.sql).toBeLessThanOrEqual(9);
    const r50 = await measure("GET /messages/directory (mọi nhóm, 50)", () =>
      uc().directory(w(), q({ limit: 50 })),
    );
    expect(r50.sql).toBe(r.sql); // không đổi theo limit
    expect(r.p95).toBeLessThanOrEqual(350);
    const out = await uc().directory(w(), q());
    const partner = out.groups.filter((g) => g.kind === "partner");
    expect(partner).toHaveLength(PEERS);
    for (const g of partner) {
      expect(g.total).toBe(PER);
      expect(g.items).toHaveLength(15);
      expect(g.next_cursor).not.toBeNull();
    }
    expect(out.groups.find((g) => g.key === "internal")?.total).toBe(PER - 1);
    // cuộc đã có lên trước người chưa nhắn: 100 cuộc/công ty đứng đầu
    expect(partner[0]?.items.every((i) => i.conversation !== null)).toBe(true);
  });

  it("«Xem thêm» một nhóm đối tác (cursor) và nhóm nội bộ: số câu cố định, p95 ≤ ngưỡng", async () => {
    const first = (await uc().directory(w(), q())).groups;
    const g = first.find((x) => x.kind === "partner");
    const r1 = await measure("Xem thêm nhóm công ty (15)", () =>
      uc().directory(w(), q({ group: g?.key, cursor: g?.next_cursor as string })),
    );
    expect(r1.sql).toBeLessThanOrEqual(7);
    expect(r1.p95).toBeLessThanOrEqual(250);
    const inn = first.find((x) => x.key === "internal");
    const r2 = await measure("Xem thêm nhóm Nội bộ (15)", () =>
      uc().directory(w(), q({ group: "internal", cursor: inn?.next_cursor as string })),
    );
    expect(r2.sql).toBeLessThanOrEqual(5);
    expect(r2.p95).toBeLessThanOrEqual(100);
  });

  it("tìm kiếm theo tên: số câu cố định, p95 ≤ ngưỡng", async () => {
    const r = await measure("GET /messages/directory?q=user 98", () =>
      uc().directory(w(), q({ q: "user 98" })),
    );
    expect(r.sql).toBeLessThanOrEqual(9);
    expect(r.p95).toBeLessThanOrEqual(350);
  });
});
