// tool-tenant-purge · hộp thư đối tác hai bên (CR-124 hub 0117/0120 + contracts 0085): xoá A thì GIỮ lịch sử của B, ẩn danh A
// («Công ty đã xoá», id tombstone, không còn tên/MST/bản chia sẻ/tệp/email của A); dòng chưa tới tay B / kênh email bị xoá; xoá nốt B ⇒ hết dòng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PARTNER_DELETED_KEY,
  PARTNER_DELETED_NAME,
  PARTNER_DELETED_TENANT_ID,
} from "@ai/contracts/pack-contracts";
import { contracts, enablePack, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { type PurgeDeps, runPurge } from "./tenant-purge";
import type { FileStore } from "./tenant-purge.files";
import { parsePurgeArgs } from "./tenant-purge.rules";

const X = PARTNER_DELETED_TENANT_ID;
const MST_A = "0101111111";
const MST_B = "0202222222";
let sql: Sql;
let dir: string;
let A = "";
let B = "";
let cB = "";
let cB2 = "";
let cA = "";
const ids = { m1: "", m2: "", m3: "", m4: "", m5: "" };

const removed: string[] = [];
const store: FileStore = {
  list: async () => [],
  remove: async (id) => {
    removed.push(id);
    return "deleted";
  },
};
const C = "00000000-0000-4000-8000-0000000000cc"; // công ty thứ ba (không có dòng tenant): đối tác nhắn tin của A, đã có thread (tombstone, uC)
const D = "00000000-0000-4000-8000-0000000000dd"; // công ty thứ tư: chưa có thread đích
const TH = (n: number) => `00000000-0000-4000-8000-0000000c000${n}`;
const U = (n: number) => `00000000-0000-4000-8000-0000000b000${n}`;
const [uA, uA2, uB, uC, uD] = [U(1), U(2), U(3), U(4), U(5)];
type Side = [tenant: string, user: string];
/** Dòng pmsg_threads: hai đầu xếp theo (tenant,user) tăng (CHECK), mốc đọc đi theo từng đầu. */
function th(n: number, p: Side, q: Side, last: number, rp: number, rq: number) {
  const [a, b, ra, rb] = `${p[0]}${p[1]}` < `${q[0]}${q[1]}` ? [p, q, rp, rq] : [q, p, rq, rp];
  return [TH(n), a[0], a[1], b[0], b[1], last, ra, rb];
}
const deps = (): PurgeDeps => ({
  files: store,
  log: () => {},
  operator: "int-test",
  statePath: (id) => join(dir, `${id}.json`),
});
const purge = (id: string, name: string) =>
  runPurge(sql, parsePurgeArgs(["--tenant", id, "--apply", "--confirm", name]), deps());
const one = async (text: string, p: unknown[] = []) =>
  ((await sql.unsafe(text, p as never[])) as unknown as Record<string, unknown>[])[0];

async function seedMailbox(
  from: string,
  to: string | null,
  channel: string,
  ...[status, extra = {}]: [
    status: string,
    extra?: { toEmail?: string; payload?: object; outcome?: string },
  ]
): Promise<string> {
  const r = await one(
    `insert into hub.partner_mailbox (from_tenant, to_tenant, to_email, channel, from_ref, payload, file_ref, pdf_sha256, status,
       outcome, reason, replied_by_source, replied_at, evidence, expires_at)
     values ($1::uuid, $2::uuid, $3, $4, 'ref-' || $1, $5::text::jsonb, 'fb/file-' || $1, repeat('a', 64), $6, $7,
       $8, $9, $10, $11::text::jsonb, now() + interval '30 days') returning id::text as id`,
    [
      from,
      to,
      extra.toEmail ?? null,
      channel,
      JSON.stringify(extra.payload ?? { name: `Tenant of ${from}`, mst: MST_A }),
      status,
      extra.outcome ?? null,
      extra.outcome ? "lý do của bên trả lời" : null,
      extra.outcome ? "receiver_flow" : null,
      extra.outcome ? new Date().toISOString() : null,
      extra.outcome ? JSON.stringify({ by: "Nguyễn Văn B" }) : null,
    ],
  );
  return r?.id as string;
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(3);
  dir = mkdtempSync(join(tmpdir(), "tenant-purge-partner-"));
  [A, B] = (await tenants(sql, 2, 7301)) as [string, string];
  await enablePack(sql, [A, B], "contracts");
  const [ua] = (await users(sql, A, 1, { from: 7301 })) as [string];
  const [ub] = (await users(sql, B, 1, { from: 7302 })) as [string];
  [cA] = (await contracts(sql, A, 1, { from: 7301, createdBy: ua, owner: ua })) as [string];
  [cB, cB2] = (await contracts(sql, B, 2, { from: 7302, createdBy: ub, owner: ub })) as [
    string,
    string,
  ];
  // m1: A gửi B (đã giao, B có bản sao). m4: B gửi A (A đã trả lời, B có vòng gửi). m2: A gửi email (có nhật ký). m3: A gửi B nhưng B chưa nhận (held).
  ids.m1 = await seedMailbox(A, B, "platform", "delivered");
  ids.m4 = await seedMailbox(B, A, "platform", "replied", {
    payload: { name: "Tenant 7302", mst: MST_B },
    outcome: "confirmed",
  });
  ids.m2 = await seedMailbox(A, null, "email", "sent", { toEmail: "ngoai@example.com" });
  ids.m3 = await seedMailbox(A, B, "platform", "held");
  // m5: chưa giao (sent) nhưng B ĐÃ có bản sao ⇒ phải giữ (ẩn danh) để bản sao còn mailbox_id hợp lệ.
  ids.m5 = await seedMailbox(A, B, "platform", "sent");
  const ubId = (await one("select id::text as id from admin.users where tenant_id = $1::uuid", [B]))
    ?.id as string;
  await sql`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, expires_at)
    values (${B}::uuid, ${cB2}::uuid, ${ids.m5}::uuid, 'Tenant 7301', now() + interval '30 days')`;
  // Dữ liệu KHÁC của B có tên A: tiêu đề HĐ nhận, lịch sử HĐ (nhận + gửi), chuông; cộng một dòng audit của B.
  await sql`update contracts.contracts set title = 'Hợp đồng từ Tenant 7301' where id = ${cB}::uuid`;
  await sql`insert into contracts.contract_events (tenant_id, contract_id, type, data) values
    (${B}::uuid, ${cB}::uuid, 'partner_received', '{"from":"Tenant 7301","round":1}'::jsonb),
    (${B}::uuid, ${cB}::uuid, 'partner_sent', '{"to":"Tenant 7301","round":1}'::jsonb)`;
  await sql`insert into hub.notifications (tenant_id, user_id, source, kind, title, body, dedup_key)
    values (${B}::uuid, ${ubId}::uuid, 'contracts', 'info', 'Hợp đồng từ Tenant 7301', 'Tenant 7301 gửi bạn một hợp đồng', 'partner-purge-1')`;
  await sql`insert into admin.audit_log (tenant_id, action, entity, entity_name, summary)
    values (${B}::uuid, 'update', 'user', 'u7302', '{}'::jsonb)`;
  await sql`insert into hub.partner_email_events (mailbox_id, event, ip_prefix, actor_name) values (${ids.m2}::uuid, 'opened', '1.2.3', 'Người ngoài')`;
  await sql`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, sender_tax_code, sender_verified,
      message, shared, file_ref, pdf_sha256, expires_at)
    values (${B}::uuid, ${cB}::uuid, ${ids.m1}::uuid, 'Tenant 7301', ${MST_A}, true, 'xin chào', '{"k":"của A"}'::jsonb, 'fb/file-a',
      ${"a".repeat(64)}, now() + interval '30 days')`;
  await sql`insert into contracts.partner_sends (tenant_id, contract_id, mailbox_id, channel, to_key, to_name, status, created_by)
    values (${B}::uuid, ${cB}::uuid, ${ids.m4}::uuid, 'platform', ${`tax:${MST_A}`}, 'Tenant 7301', 'confirmed', ${(await one("select id::text as id from admin.users where tenant_id = $1::uuid", [B]))?.id as string}::uuid)`;
  await sql`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}::uuid, ${B}::uuid, now(), now())`;
  await sql`insert into hub.partner_links (from_tenant, to_tenant, requested_at) values (${B}::uuid, ${A}::uuid, now())`;
  const ubId0 = (
    await one("select id::text as id from admin.users where tenant_id = $1::uuid", [B])
  )?.id as string;
  // CR-169: nhắn tin người–người. TH1 A–B (tin của cả hai, tin A có tệp, mốc đọc cả hai); TH2 (tombstone, C) đã có từ lần xoá trước + TH3 (uA, C) và
  // TH4 (uA2, C) ⇒ cả hai gộp vào TH2; TH5 (uA, D) và TH6 (uA2, D) chưa có đích ⇒ TH6 gộp vào TH5 (nhỏ nhất, giữ tại chỗ).
  await sql`insert into hub.pmsg_threads (id, a_tenant, a_user, b_tenant, b_user, last_seq, a_read_seq, b_read_seq)
    values ${sql([
      th(1, [A, uA], [B, uB], 2, 1, 2),
      th(2, [X, X], [C, uC], 3, 0, 1),
      th(3, [A, uA], [C, uC], 2, 1, 2),
      th(4, [A, uA2], [C, uC], 1, 1, 0),
      th(5, [A, uA], [D, uD], 1, 1, 1),
      th(6, [A, uA2], [D, uD], 1, 1, 0),
    ] as never)}`;
  await sql`insert into hub.pmsg_messages (thread_id, seq, sender_user, body, files, client_id) values
    (${TH(1)}::uuid, 1, ${uA}::uuid, 'xin chào từ A', '[{"id":"f1","name":"a.pdf","mime":"application/pdf","size":1}]'::jsonb, gen_random_uuid()),
    (${TH(1)}::uuid, 2, ${uB}::uuid, 'chào lại', '[]'::jsonb, gen_random_uuid()),
    (${TH(2)}::uuid, 1, ${X}::uuid, 'cũ 1', '[]'::jsonb, gen_random_uuid()),
    (${TH(2)}::uuid, 2, ${uC}::uuid, 'cũ 2', '[]'::jsonb, gen_random_uuid()),
    (${TH(2)}::uuid, 3, ${X}::uuid, 'cũ 3', '[]'::jsonb, gen_random_uuid()),
    (${TH(3)}::uuid, 1, ${uA}::uuid, 'A gửi C', '[]'::jsonb, gen_random_uuid()),
    (${TH(3)}::uuid, 2, ${uC}::uuid, 'C trả lời', '[]'::jsonb, gen_random_uuid()),
    (${TH(4)}::uuid, 1, ${uA2}::uuid, 'A2 gửi C', '[]'::jsonb, gen_random_uuid()),
    (${TH(5)}::uuid, 1, ${uA}::uuid, 'A gửi D', '[]'::jsonb, gen_random_uuid()),
    (${TH(6)}::uuid, 1, ${uA2}::uuid, 'A2 gửi D', '[]'::jsonb, gen_random_uuid())`;
  // Tệp của A ở TH1 (id FileBox 'boxA1' phải bị xoá ở kho); tệp của C ở TH3 (seq 2) phải theo tin sang TH2.
  await sql`insert into hub.pmsg_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key, box_file_id, seq) values
    (${TH(9)}::uuid, ${TH(1)}::uuid, ${A}::uuid, ${uA}::uuid, 'a.pdf', 'application/pdf', 10, ${`${A}/${TH(9)}`}, 'boxA1', 1),
    (${TH(8)}::uuid, ${TH(3)}::uuid, ${C}::uuid, ${uC}::uuid, 'c.pdf', 'application/pdf', 10, ${`${C}/${TH(8)}`}, 'boxC1', 2)`;
  // Chuông của B (hub.cc_bell) nhắc tên A: lời mời, và «đồng ý» có link party=<tên>&tenant=<A>.
  await sql`insert into hub.notifications (tenant_id, user_id, source, kind, title, body, link, dedup_key, fanout_at) values
    (${B}::uuid, ${ubId0}::uuid, 'contracts', 'cc.invite', 'Tenant 7301 muốn kết nối với bạn', '', '/contracts/partners?invites=1', 'cc.invite:x:1', now()),
    (${B}::uuid, ${ubId0}::uuid, 'contracts', 'cc.accepted', 'Tenant 7301 đã đồng ý kết nối', '', ${`/contracts/partners?party=Tenant%207301&tenant=${A}&tab=chat`}, 'cc.accepted:x:1', now())`;
});
afterAll(async () => {
  await sql.end();
  rmSync(dir, { recursive: true, force: true });
});

async function expectMailboxAnonymized(): Promise<void> {
  const m1 = await one("select * from hub.partner_mailbox where id = $1::uuid", [ids.m1]);
  expect(m1).toMatchObject({
    from_tenant: X,
    to_tenant: B,
    status: "delivered",
    payload: {},
    from_ref: null,
    file_ref: null,
    pdf_sha256: null,
  });
  const m4 = await one("select * from hub.partner_mailbox where id = $1::uuid", [ids.m4]);
  expect(m4).toMatchObject({
    from_tenant: B,
    to_tenant: X,
    status: "replied",
    outcome: "confirmed",
    reason: null,
    evidence: null,
  });
  const dump = JSON.stringify(
    await sql`select to_jsonb(m) as j from hub.partner_mailbox m union all select to_jsonb(l) from hub.partner_links l`,
  );
  for (const s of [A, MST_A, "Tenant of", "ngoai@example.com", "Người ngoài", "của A"])
    expect(dump.includes(s)).toBe(false);
}

async function expectCopiesAndLinksAnonymized(): Promise<void> {
  // Bản sao phía B còn nối đúng hộp thư, nhưng tên/MST/bản chia sẻ của A đã mất.
  const inbox = await one(
    "select * from contracts.partner_inbox where tenant_id = $1::uuid and mailbox_id = $2::uuid",
    [B, ids.m1],
  );
  expect(inbox).toMatchObject({
    sender_name: PARTNER_DELETED_NAME,
    sender_tax_code: null,
    sender_verified: false,
    message: null,
    shared: {},
    file_ref: null,
    pdf_sha256: null,
  });
  const send = await one(
    "select to_name, to_key from contracts.partner_sends where tenant_id = $1::uuid and mailbox_id = $2::uuid",
    [B, ids.m4],
  );
  expect(send).toEqual({ to_name: PARTNER_DELETED_NAME, to_key: PARTNER_DELETED_KEY });
  // Liên kết: lời mời chưa chấp nhận bị xoá, liên kết đã chấp nhận còn nhưng ẩn danh.
  const links =
    await sql`select from_tenant::text as f, to_tenant::text as t from hub.partner_links`;
  expect(links.map((l) => [l.f, l.t])).toEqual([[X, B]]);
}

describe("tool-tenant-purge · đối tác hai bên (giữ lịch sử, ẩn danh bên bị xoá)", () => {
  it("xoá A giữ lịch sử của B và ẩn danh A thành «Công ty đã xoá»", async () => {
    const r = await purge(A, "Tenant 7301");
    expect(r.kind).toBe("applied");
    const left = (await sql`select id::text as id from hub.partner_mailbox order by 1`).map(
      (x) => x.id,
    );
    expect(left.sort()).toEqual([ids.m1, ids.m4, ids.m5].sort());
    // Bản sao nào của B cũng còn trỏ tới một hộp thư tồn tại.
    expect(
      (
        await sql`select 1 from contracts.partner_inbox i
          where not exists (select 1 from hub.partner_mailbox m where m.id = i.mailbox_id)`
      ).length,
    ).toBe(0);
    // Dữ liệu khác của B (tiêu đề HĐ, lịch sử HĐ, chuông, audit) không còn tên A.
    const bText = JSON.stringify([
      await sql`select title from contracts.contracts where tenant_id = ${B}::uuid`,
      await sql`select data from contracts.contract_events where tenant_id = ${B}::uuid`,
      await sql`select title, body from hub.notifications where tenant_id = ${B}::uuid`,
      await sql`select to_jsonb(a) as j from admin.audit_log a where a.tenant_id = ${B}::uuid`,
    ]);
    expect(bText.includes("Tenant 7301")).toBe(false);
    expect(bText.includes(PARTNER_DELETED_NAME)).toBe(true);
    expect((await sql`select 1 from hub.partner_email_events`).length).toBe(0);
    // Mọi dấu vết của A trong hộp thư: không còn id A, tên/MST/tệp/ref (cả cột lẫn JSON).
    expect(
      (
        await sql`select 1 from hub.partner_mailbox where from_tenant = ${A}::uuid or to_tenant = ${A}::uuid`
      ).length,
    ).toBe(0);
    await expectMailboxAnonymized();
    await expectCopiesAndLinksAnonymized();
    // Audit ghi số liệu đối tác.
    const au = await one(
      "select summary -> 'partner' as p from admin.audit_log where entity_id = $1::uuid and action = 'delete'",
      [A],
    );
    expect(au?.p).toMatchObject({
      mailboxDeleted: 2,
      mailboxAnonymized: 3,
      copiesAnonymized: 3,
      pmsgThreadsAnonymized: 2,
      pmsgThreadsMerged: 2,
      pmsgThreadsDeleted: 0,
      pmsgMessagesAnonymized: 5,
    });
  });

  it("CR-169 · nhắn tin: thread A–B còn cho B (tin A giữ chữ, người gửi → tombstone, bỏ tệp), tin/mốc đọc của B y nguyên", async () => {
    const [th1] =
      await sql`select a_tenant::text as at, a_user::text as au, b_tenant::text as bt, b_user::text as bu, a_read_seq::int as ar, b_read_seq::int as br from hub.pmsg_threads where id = ${TH(1)}::uuid`;
    expect(new Set([th1?.at, th1?.bt])).toEqual(new Set([X, B]));
    expect(`${th1?.at}${th1?.au}` < `${th1?.bt}${th1?.bu}`).toBe(true); // CHECK (a) < (b)
    const aIsX = th1?.at === X;
    expect(aIsX ? th1?.au : th1?.bu).toBe(X);
    expect(aIsX ? th1?.bu : th1?.au).toBe(uB);
    expect([aIsX ? th1?.ar : th1?.br, aIsX ? th1?.br : th1?.ar]).toEqual([0, 2]); // mốc A về 0, B giữ
    const msgs =
      await sql`select seq::int as seq, sender_user::text as u, body, files from hub.pmsg_messages where thread_id = ${TH(1)}::uuid order by seq`;
    expect(msgs.map((m) => [m.seq, m.u, m.body, m.files])).toEqual([
      [1, X, "xin chào từ A", []],
      [2, uB, "chào lại", []],
    ]);
    expect(JSON.stringify(msgs).includes(uA)).toBe(false);
  });

  it("CR-169 · tệp nhắn tin của A: id FileBox bị xoá ở kho, tệp của công ty khác không", async () => {
    expect(removed).toContain("boxA1");
    expect(removed).not.toContain("boxC1");
    expect((await sql`select 1 from hub.pmsg_files where tenant_id = ${A}::uuid`).length).toBe(0);
  });

  it("CR-169 · nhắn tin: đã có thread (tombstone, C) ⇒ GỘP TH3, TH4 vào đó, C không mất tin/tệp/mốc đọc, last_seq cộng dồn", async () => {
    expect(
      (await sql`select 1 from hub.pmsg_threads where id in (${TH(3)}::uuid, ${TH(4)}::uuid)`)
        .length,
    ).toBe(0);
    const [d] =
      await sql`select last_seq::int as n, case when a_tenant = ${C}::uuid then a_read_seq else b_read_seq end::int as cr from hub.pmsg_threads where id = ${TH(2)}::uuid`;
    expect([d?.n, d?.cr]).toEqual([6, 5]);
    const msgs =
      await sql`select seq::int as seq, sender_user::text as u, body from hub.pmsg_messages where thread_id = ${TH(2)}::uuid order by seq`;
    expect(msgs.map((m) => [m.seq, m.u, m.body])).toEqual([
      [1, X, "cũ 1"],
      [2, uC, "cũ 2"],
      [3, X, "cũ 3"],
      [4, X, "A gửi C"],
      [5, uC, "C trả lời"],
      [6, X, "A2 gửi C"],
    ]);
    const f =
      await sql`select thread_id::text as th, seq::int as seq from hub.pmsg_files where box_file_id = 'boxC1'`;
    expect(f.map((x) => [x.th, x.seq])).toEqual([[TH(2), 5]]);
  });

  it("CR-169 · nhắn tin: chưa có đích ⇒ thread nhỏ nhất giữ tại chỗ, thread kia gộp vào, mốc đọc A về 0", async () => {
    expect((await sql`select 1 from hub.pmsg_threads where id = ${TH(6)}::uuid`).length).toBe(0);
    const [t] =
      await sql`select last_seq::int as n, a_tenant::text as at, a_read_seq::int as ar, b_read_seq::int as br from hub.pmsg_threads where id = ${TH(5)}::uuid`;
    expect(t?.n).toBe(2);
    expect((t?.ar as number) + (t?.br as number)).toBe(1); // mốc đọc của D giữ, của A về 0
    const msgs =
      await sql`select seq::int as seq, sender_user::text as u, body from hub.pmsg_messages where thread_id = ${TH(5)}::uuid order by seq`;
    expect(msgs.map((m) => [m.seq, m.u, m.body])).toEqual([
      [1, X, "A gửi D"],
      [2, X, "A2 gửi D"],
    ]);
  });

  it("CR-161 · chuông cc.* của B nhắc tên A ⇒ «Công ty đã xoá», link không còn tên/tenant A", async () => {
    const bells =
      await sql`select title, link from hub.notifications where tenant_id = ${B}::uuid and kind like 'cc.%' order by kind`;
    expect(bells.map((b) => b.title)).toEqual([
      `${PARTNER_DELETED_NAME} đã đồng ý kết nối`,
      `${PARTNER_DELETED_NAME} muốn kết nối với bạn`,
    ]);
    expect(bells.map((b) => b.link)).toEqual([
      "/contracts/partners",
      "/contracts/partners?invites=1",
    ]);
  });
});

describe("tool-tenant-purge · đối tác hai bên (giữ lịch sử, ẩn danh bên bị xoá)", () => {
  it("id tombstone không dùng được làm tenant thật (CHECK admin 0040)", async () => {
    const code =
      await sql`insert into admin.tenants (id, key, name) values (${X}::uuid, 'tomb', 'Tomb')`.then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
    expect(code).toBe("23514");
  });

  it("xoá nốt B (bên kia đã xoá) ⇒ hết dòng ở hộp thư và liên kết", async () => {
    const r = await purge(B, "Tenant 7302");
    expect(r.kind).toBe("applied");
    expect((await sql`select 1 from hub.partner_mailbox`).length).toBe(0);
    expect((await sql`select 1 from hub.partner_links`).length).toBe(0);
    expect((await sql`select 1 from hub.partner_email_events`).length).toBe(0);
    // CR-169: bên kia cũng đã xoá ⇒ thread (tin) bị xoá hẳn; thread (tombstone, C) còn cho C.
    expect((await sql`select 1 from hub.pmsg_threads where id = ${TH(1)}::uuid`).length).toBe(0);
    expect(
      (await sql`select 1 from hub.pmsg_messages where thread_id = ${TH(1)}::uuid`).length,
    ).toBe(0);
    expect((await sql`select 1 from hub.pmsg_threads where id = ${TH(2)}::uuid`).length).toBe(1);
  });
});
