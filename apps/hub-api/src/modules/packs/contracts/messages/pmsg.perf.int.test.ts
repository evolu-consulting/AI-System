// CR-169 · lát 3b · Luật 4c · spec §6: đo đường nóng cuộc `partner` trên DB thật (role `contracts_rw`): trang 50 tin của cuộc 100.000 tin (mới nhất + trang sâu), gửi tin.
// (1) số câu SQL của repo mỗi thao tác CỐ ĐỊNH = 1 (đếm ở `tx.execute`) — kiểm cứng; (2) p95 in ra console, ngưỡng spec (trang ≤ 20 ms, gửi ≤ 40 ms) chỉ cảnh báo, KHÔNG chặn
// (mốc hiện tại ưu tiên đúng + chạy được; xem tasks.md CR-169).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
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

const A = tenantId(1690);
const B = tenantId(1691);
const VY = userId(1690);
const HA = userId(1691);
const BIG = 100_000;
const RUNS = 40;
let o: Sql;
let db: Db;
let tid = "";
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
const uc = () =>
  messagesUsecases({
    uow: createPackUow(db, "contracts", (tx, t) => ({
      messages: messagesRepo(counting(tx), t),
      partner: partnerRepo(counting(tx), t),
    })) as never as PackUow<MessagesRepos>,
    people: internalUsersAmong(db),
    newId: () => Bun.randomUUIDv7(),
  });
const w = { tenantId: A, userId: VY };

async function measure(name: string, ms: number, fn: () => Promise<unknown>) {
  await fn(); // làm nóng kết nối/chuẩn bị câu
  const t: number[] = [];
  statements = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const p95 = t[Math.ceil(RUNS * 0.95) - 1] ?? 0;
  const per = statements / RUNS;
  console.log(
    `[perf CR-169 3b] ${name}: p95 ${p95.toFixed(1)} ms (ngưỡng ${ms}${p95 > ms ? " — CHƯA ĐẠT" : ""}) · ${per} câu SQL repo / thao tác`,
  );
  return per;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'pp-a', 'A', 'NitiGroup', '0100000601', true), (${B}, 'pp-b', 'B', 'Preschool Việt', '0100000602', true)`;
  await users(o, A, 1, { from: 1690 });
  await users(o, B, 1, { from: 1691 });
  const grp = await enablePack(o, [A, B], "contracts");
  const g = (t: string) => grp.get(t) as Record<"owner" | "editor" | "viewer", string>;
  await members(o, A, g(A).owner, [VY]);
  await members(o, B, g(B).owner, [HA]);
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at) values (${A}, ${B}, now()), (${B}, ${A}, now())`;
  db = connectDb(urls().hubApi, 3);
  const made = await uc().create(w, { kind: "partner", tenant_id: B, user_id: HA });
  tid = made.detail.id;
  await o`insert into hub.pmsg_messages (thread_id, seq, sender_user, body, client_id)
    select ${tid}::uuid, s, case when s % 2 = 0 then ${VY}::uuid else ${HA}::uuid end, 'tin số ' || s, gen_random_uuid()
    from generate_series(1, ${BIG}) s`;
  await o`update hub.pmsg_threads set last_seq = ${BIG}, last_at = now() where id = ${tid}`;
  await o.unsafe("analyze hub.pmsg_messages");
  await o.unsafe("analyze hub.pmsg_threads");
}, 600_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-169 3b · perf cuộc partner (spec §6)", () => {
  it("trang 50 tin của cuộc 100.000 tin (mới nhất + trang sâu): 1 câu SQL", async () => {
    const p = await uc().partnerMessages(w, tid, { limit: 50 });
    expect([p.items.length, p.items.at(-1)?.seq, p.has_more]).toEqual([50, BIG, true]);
    expect(
      await measure("GET …/messages (50)", 20, () => uc().partnerMessages(w, tid, { limit: 50 })),
    ).toBe(1);
    expect(
      await measure("GET …/messages (50, before=50.000)", 20, () =>
        uc().partnerMessages(w, tid, { limit: 50, before_seq: 50_000 }),
      ),
    ).toBe(1);
  });

  it("gửi tin: 1 câu SQL repo (hàm pmsg_send), gửi lặp trả bản cũ", async () => {
    expect(
      await measure("POST …/messages", 40, () =>
        uc().partnerSend(w, tid, { client_id: Bun.randomUUIDv7(), body: "đo", file_ids: [] }),
      ),
    ).toBe(1);
    const cid = Bun.randomUUIDv7();
    const first = await uc().partnerSend(w, tid, { client_id: cid, body: "lặp", file_ids: [] });
    const again = await uc().partnerSend(w, tid, { client_id: cid, body: "lặp", file_ids: [] });
    expect([first.created, again.created, again.message.seq]).toEqual([
      true,
      false,
      first.message.seq,
    ]);
  });
});
