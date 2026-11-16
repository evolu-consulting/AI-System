// CR-178 M3 · đo tìm tin trên DB thật: 100 cuộc nhóm × 500 tin (50.000) + 20 cuộc `partner` × 500 tin (10.000); ~1% tin chứa «báo giá». Hiệu năng đang HOÃN (không chặn): chỉ ĐẾM số câu SQL
// (phải CỐ ĐỊNH, không theo số dòng) và IN p95 thật; ngưỡng thời gian chỉ ở mức «không hỏng» (≤ 2 s) để bắt lỗi quét toàn bảng nghiêm trọng.
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

const CONVS = 100;
const PER_CONV = 500;
const RUNS = 30;
let o: Sql;
let db: Db;
let T = "";
let P = "";
let statements = 0;
const cids = Array.from(
  { length: CONVS },
  (_, i) => `c1780000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
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
    partner: partnerRepo(counting(tx), t),
  })) as never as PackUow<MessagesRepos>;
const uc = () =>
  messagesUsecases({ uow: uow(), people: internalUsersAmong(db), newId: () => Bun.randomUUIDv7() });
const w = () => ({ tenantId: T, userId: P });

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
  ms.sort((a, b) => a - b);
  const p95 = ms[Math.ceil(RUNS * 0.95) - 1] ?? 0;
  const per = statements / RUNS;
  console.log(
    `[perf CR-178 M3] ${name}: p95 ${p95.toFixed(1)} ms · ${per} câu SQL repo / thao tác`,
  );
  return { p95, sql: per };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  [T] = (await tenants(o, 1, 9781)) as [string];
  const [u] = (await users(o, T, 1, { from: 9781 })) as [string];
  P = u as string;
  await o`insert into contracts.msg_conversations (tenant_id, id, kind, title, created_by, last_seq, last_at)
    select ${T}::uuid, c::uuid, 'group', 'Nhóm ' || i, ${P}::uuid, ${PER_CONV}, now() - (i || ' minutes')::interval
    from unnest(${cids}::text[]) with ordinality as x(c, i)`;
  await o`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role, last_read_seq)
    select ${T}::uuid, c::uuid, ${P}::uuid, 'owner', ${PER_CONV} from unnest(${cids}::text[]) as c`;
  await o`insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body, created_at)
    select ${T}::uuid, c::uuid, s, ${P}::uuid, gen_random_uuid(),
      'tin số ' || s || case when s % 100 = 0 then ' Báo giá hợp đồng' else '' end, now() - ((600 - s) || ' minutes')::interval
    from unnest(${cids}::text[]) as c cross join generate_series(1, ${PER_CONV}) as s`;
  const peers = (await tenants(o, 20, 9800)) as string[];
  const g = await enablePack(o, [T, ...peers], "contracts");
  await members(o, T, g.get(T)?.viewer as string, [P]);
  for (const [k, pt] of peers.entries()) {
    const us = (await users(o, pt, 1, { from: 9900 + k })) as string[];
    await members(o, pt, g.get(pt)?.viewer as string, us);
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    select ${T}::uuid, p::uuid, now() from unnest(${peers}::text[]) p
    union all select p::uuid, ${T}::uuid, now() from unnest(${peers}::text[]) p`;
  await o`insert into hub.pmsg_threads (id, a_tenant, a_user, b_tenant, b_user, last_seq, last_at)
    select gen_random_uuid(), case when p_first then ${T}::uuid else x.pt end, case when p_first then ${P}::uuid else x.pu end,
           case when p_first then x.pt else ${T}::uuid end, case when p_first then x.pu else ${P}::uuid end, ${PER_CONV}::bigint, now()
      from (select u.tenant_id as pt, u.id as pu, (${T}::uuid, ${P}::uuid) < (u.tenant_id, u.id) as p_first
              from admin.users u where u.tenant_id = any(${peers}::uuid[])) x`;
  await o`insert into hub.pmsg_messages (thread_id, seq, sender_user, body, client_id, created_at)
    select t.id, s, case when t.a_user = ${P}::uuid then t.b_user else t.a_user end, 'tin số ' || s || case when s % 100 = 0 then ' Báo giá hợp đồng' else '' end,
           gen_random_uuid(), now() - ((600 - s) || ' minutes')::interval
      from hub.pmsg_threads t cross join generate_series(1, ${PER_CONV}::int) as s`;
  for (const t of ["contracts.msg_messages", "hub.pmsg_messages", "hub.pmsg_threads"])
    await o.unsafe(`analyze ${t}`);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-178 M3 · perf tìm tin (60.000 tin, nội bộ + partner)", () => {
  it("tìm «bao gia» mọi cuộc (20 kết quả/trang): số câu SQL cố định, báo p95; trang 2 theo con trỏ cùng số câu", async () => {
    const first = await uc().search(w(), {
      q: "bao gia",
      conversationId: null,
      cur: null,
      limit: 20,
    });
    expect(first.items.length).toBe(20);
    expect(first.next_cursor).not.toBeNull();
    const r = await measure("GET /messages/search (mọi cuộc, trang 1)", () =>
      uc().search(w(), { q: "bao gia", conversationId: null, cur: null, limit: 20 }),
    );
    expect(r.sql).toBe(2); // nội bộ + partner, KHÔNG theo số hàng/cuộc
    expect(r.p95).toBeLessThanOrEqual(2000);
    const cur = (await import("./application/messages.search")).decodeSearchCursor(
      first.next_cursor as string,
    );
    const r2 = await measure("GET /messages/search (trang 2, con trỏ)", () =>
      uc().search(w(), { q: "bao gia", conversationId: null, cur, limit: 20 }),
    );
    expect(r2.sql).toBe(2);
  });
  it("tìm trong MỘT cuộc (nút ↑↓): số câu cố định, báo p95", async () => {
    const r = await measure("GET /messages/search (một cuộc)", () =>
      uc().search(w(), { q: "bao gia", conversationId: cids[3] as string, cur: null, limit: 20 }),
    );
    expect(r.sql).toBe(2);
    expect(r.p95).toBeLessThanOrEqual(2000);
  });
});
