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
let cA = "";
const ids = { m1: "", m2: "", m3: "", m4: "" };

const store: FileStore = { list: async () => [], remove: async () => "missing" };
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
  status: string,
  extra: { toEmail?: string; payload?: object; outcome?: string } = {},
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
  [cB] = (await contracts(sql, B, 1, { from: 7302, createdBy: ub, owner: ub })) as [string];
  // m1: A gửi B (đã giao, B có bản sao). m4: B gửi A (A đã trả lời, B có vòng gửi). m2: A gửi email (có nhật ký). m3: A gửi B nhưng B chưa nhận (held).
  ids.m1 = await seedMailbox(A, B, "platform", "delivered");
  ids.m4 = await seedMailbox(B, A, "platform", "replied", {
    payload: { name: "Tenant 7302", mst: MST_B },
    outcome: "confirmed",
  });
  ids.m2 = await seedMailbox(A, null, "email", "sent", { toEmail: "ngoai@example.com" });
  ids.m3 = await seedMailbox(A, B, "platform", "held");
  await sql`insert into hub.partner_email_events (mailbox_id, event, ip_prefix, actor_name) values (${ids.m2}::uuid, 'opened', '1.2.3', 'Người ngoài')`;
  await sql`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, sender_tax_code, sender_verified,
      message, shared, file_ref, pdf_sha256, expires_at)
    values (${B}::uuid, ${cB}::uuid, ${ids.m1}::uuid, 'Tenant 7301', ${MST_A}, true, 'xin chào', '{"k":"của A"}'::jsonb, 'fb/file-a',
      ${"a".repeat(64)}, now() + interval '30 days')`;
  await sql`insert into contracts.partner_sends (tenant_id, contract_id, mailbox_id, channel, to_key, to_name, status, created_by)
    values (${B}::uuid, ${cB}::uuid, ${ids.m4}::uuid, 'platform', ${`tax:${MST_A}`}, 'Tenant 7301', 'confirmed', ${(await one("select id::text as id from admin.users where tenant_id = $1::uuid", [B]))?.id as string}::uuid)`;
  await sql`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}::uuid, ${B}::uuid, now(), now())`;
  await sql`insert into hub.partner_links (from_tenant, to_tenant, requested_at) values (${B}::uuid, ${A}::uuid, now())`;
});
afterAll(async () => {
  await sql.end();
  rmSync(dir, { recursive: true, force: true });
});

describe("tool-tenant-purge · đối tác hai bên (giữ lịch sử, ẩn danh bên bị xoá)", () => {
  it("xoá A giữ lịch sử của B và ẩn danh A thành «Công ty đã xoá»", async () => {
    const r = await purge(A, "Tenant 7301");
    expect(r.kind).toBe("applied");
    const left = (await sql`select id::text as id from hub.partner_mailbox order by 1`).map(
      (x) => x.id,
    );
    expect(left.sort()).toEqual([ids.m1, ids.m4].sort());
    expect((await sql`select 1 from hub.partner_email_events`).length).toBe(0);
    // Mọi dấu vết của A trong hộp thư: không còn id A, tên/MST/tệp/ref (cả cột lẫn JSON).
    expect(
      (
        await sql`select 1 from hub.partner_mailbox where from_tenant = ${A}::uuid or to_tenant = ${A}::uuid`
      ).length,
    ).toBe(0);
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
    // Audit ghi số liệu đối tác.
    const au = await one(
      "select summary -> 'partner' as p from admin.audit_log where entity_id = $1::uuid and action = 'delete'",
      [A],
    );
    expect(au?.p).toMatchObject({ mailboxDeleted: 2, mailboxAnonymized: 2, copiesAnonymized: 2 });
  });

  it("xoá nốt B (bên kia đã xoá) ⇒ hết dòng ở hộp thư và liên kết", async () => {
    const r = await purge(B, "Tenant 7302");
    expect(r.kind).toBe("applied");
    expect((await sql`select 1 from hub.partner_mailbox`).length).toBe(0);
    expect((await sql`select 1 from hub.partner_links`).length).toBe(0);
    expect((await sql`select 1 from hub.partner_email_events`).length).toBe(0);
  });
});
