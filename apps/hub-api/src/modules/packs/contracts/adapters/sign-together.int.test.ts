// CR-127 · P2 · BR-61 · spec §2.4 — bên NHẬN đề nghị ký cùng lúc, DB thật: (1) công ty nhận CHƯA có nhóm «Người ký HĐ» ⇒ tự «Xử lý bình thường»
// (phiên `fallback`, HĐ nhận giữ nguyên); (2) CÓ nhóm ⇒ phiên chờ trả lời, Đồng ý ⇒ `accepted`, người ký đầu tiên ký ⇒ `signing`; (3) `isSigner`
// (uỷ quyền ký số) đúng theo nhóm; (4) tenant ngoài phiên không thấy phiên (cách ly).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { contractAccess } from "../../kit/public";
import { mountContractAccess } from "../contract-access.mount";
import { receiveInbox } from "../partner-mailbox.mount";
import { assertOwnerOrAdmin } from "../sign-session.routes";
import { type SignSessionRepo, signSessionRepo } from "./sign-session.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let C = "";
let UA = "";
let UB = "";
let UB2 = "";
let UC = "";
const SHA = "c".repeat(64);
let seq = 0;

const as = <T>(t: string, u: string, fn: (r: SignSessionRepo, tx: Tx) => Promise<T>) =>
  withPackScope(db, { packKey: "contracts", tenantId: t, userId: u }, (tx: Tx) =>
    fn(signSessionRepo(tx, t), tx),
  );
const sessionStatus = async (id: string) =>
  (
    await o<
      { status: string }[]
    >`select status from hub.partner_sign_sessions where id = ${id}::uuid`
  )[0]?.status;

/** A gửi qua nền tảng kèm đề nghị ký cùng lúc (cùng tx) → B nhận lô. Trả HĐ nhận + phiên. */
async function scenario(): Promise<{ b: string; s: string }> {
  seq += 1;
  const [a] = (await contracts(o, A, 1, {
    from: 1700 + seq,
    createdBy: UA,
    status: "processing",
  })) as [string];
  const payload = JSON.stringify({
    title: `HĐ P2 ${seq}`,
    sign_together: { reason: "gấp", accept_h: 2, sign_h: 4 },
  });
  const s = await as(A, UA, async (r, tx) => {
    const [m] = await tx.execute<{
      id: string;
    }>(sql`select hub.partner_send(${A}::uuid, ${B}::uuid, null,
      'platform', ${a}, ${payload}::jsonb, null, ${SHA}, now() + interval '7 days', null)::text as id`);
    return r.propose({
      contractId: a,
      mailboxId: m?.id as string,
      reason: "gấp",
      acceptH: 2,
      signH: 4,
      pdfSha256: SHA,
    });
  });
  expect(await receiveInbox(db)(B, 100)).toBe(1);
  const [b] = await o<
    { id: string }[]
  >`select contract_id::text as id from contracts.sign_session_refs
    where tenant_id = ${B} and session_id = ${s}::uuid and side = 'to'`;
  return { b: b?.id as string, s };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, C] = (await tenants(o, 3, 1707)) as [string, string, string];
  [UA] = (await users(o, A, 1, { from: 1707 })) as [string];
  [UB, UB2] = (await users(o, B, 2, { from: 1708 })) as [string, string];
  [UC] = (await users(o, C, 1, { from: 1710 })) as [string];
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  db = connectDb(urls().hubApi, 4);
  mountContractAccess(db);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 P2 · bên nhận đề nghị ký cùng lúc", () => {
  it("chưa có nhóm «Người ký HĐ» ⇒ tự «Xử lý bình thường» (phiên fallback, HĐ nhận giữ processing)", async () => {
    const { b, s } = await scenario();
    expect(await sessionStatus(s)).toBe("fallback");
    const [r] = await o<
      { status: string }[]
    >`select status from contracts.contracts where id = ${b}::uuid`;
    expect(r?.status).toBe("processing");
  });

  it("có nhóm ⇒ phiên chờ trả lời; Đồng ý ⇒ accepted; người ký đầu tiên ký ⇒ signing; isSigner theo nhóm", async () => {
    const [g] = await o<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${B}, 'signers', ${o.json({ vi: "Người ký HĐ" })}) returning id::text as id`;
    await o`insert into admin.group_members (tenant_id, group_id, user_id) values (${B}, ${g?.id as string}, ${UB})`;
    await o`insert into contracts.partner_settings (tenant_id, signer_group_id) values (${B}, ${g?.id as string}::uuid)
      on conflict (tenant_id) do update set signer_group_id = excluded.signer_group_id`;
    const { s } = await scenario();
    expect(await sessionStatus(s)).toBe("proposed");
    expect(await as(B, UB, (r) => r.accept(s, "Bà B"))).toBe("accepted");
    expect(await as(A, UA, (r) => r.markSigned(s, "Ông A", SHA))).toBe("signing");
    expect(await sessionStatus(s)).toBe("signing");
    const acc = contractAccess();
    const tx = {} as Tx;
    expect(await acc?.isSigner(tx, B, UB)).toBe(true);
    expect(await acc?.isSigner(tx, B, UB2)).toBe(false);
    expect(await acc?.isSigner(tx, C, UC)).toBe(false);
  });

  it("cách ly: tenant ngoài phiên không thấy phiên của HĐ này", async () => {
    const { s } = await scenario();
    expect(await as(C, UC, (r) => r.mine(s)).catch(() => null)).toBeNull();
  });

  it("huỷ/trả lời phiên chỉ người phụ trách HĐ hoặc quản trị: người ghi thường ⇒ 403; HĐ tenant khác ⇒ 404", async () => {
    const { b } = await scenario();
    await o`update contracts.contracts set owner_user_id = ${UB}::uuid where id = ${b}::uuid`;
    const check = (t: string, u: string, isAdmin: boolean) =>
      withPackScope(db, { packKey: "contracts", tenantId: t, userId: u }, (tx: Tx) =>
        assertOwnerOrAdmin({ tx, tid: t }, { id: b, userId: u, isAdmin }).then(
          () => "ok",
          (e: { status?: number; code?: string }) => String(e.status ?? e.code),
        ),
      );
    expect(await check(B, UB, false)).toBe("ok");
    expect(await check(B, UB2, true)).toBe("ok");
    expect(await check(B, UB2, false)).toBe("403");
    expect(await check(C, UC, true)).toBe("404");
  });
});
