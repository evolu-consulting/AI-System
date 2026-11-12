// CR-127 · P2b · BR-63/64 · spec §2.4, §3 #12/#14a — phiên ký chung ⇄ phong bì ký số, HAI công ty thật (A gửi, B nhận), DB thật:
// phong bì một bên ký xong ⇒ phiên ghi `*_signed_at` bên đó (signing); bên kia ký xong ⇒ done + `sign.session.done` + HĐ hai bên done;
// không phiên / văn bản lệch hash ⇒ bỏ qua (không ném); huỷ phiên ⇒ cancel_side/cancel_reason + huỷ phong bì còn mở của HĐ HAI bên.
// P2c · fact `sign_together` đọc lại được cho node Nếu (HĐ nhận có phiên ⇒ true; bên gửi / về xử lý bình thường ⇒ false).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { partnerMoveOnce } from "../../../partners/mailbox-mover";
import { createPackUow, type PackRunsBridge, type PartnerMailboxPort } from "../../kit/public";
import { sessionSignedOnEnvelope } from "../application/sign-session-esign";
import { contractsFactsReader } from "../flow-events.mount";
import { onSignSessions, receiveInbox } from "../partner-mailbox.mount";
import { esignRepo } from "./esign.repo";
import { type SignSessionRepo, signSessionRepo } from "./sign-session.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";
const SHA = "c".repeat(64);
const signals: [string, string, string][] = [];
const ended: [string, string][] = [];
const warns: string[] = [];
const bridge = {
  port: {
    signalEvent: async (t: string, ref: { record_id: string }, ev: string) => {
      signals.push([t, ref.record_id, ev]);
      return 0;
    },
  },
} as unknown as PackRunsBridge;
const endEnvelope = async (t: string, c: string) => {
  ended.push([t, c]);
  return true;
};
const port = (): PartnerMailboxPort => ({
  receive: async () => 0,
  onReplies: async () => {},
  onSignSessions: onSignSessions(
    db,
    () => bridge,
    () => endEnvelope,
  ),
});
const move = () => partnerMoveOnce({ db, port });
let shaOf: (c: string) => string | null = () => SHA;
const signed = () =>
  sessionSignedOnEnvelope({
    uow: createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      signSession: signSessionRepo(tx, t),
      esign: esignRepo(tx, t),
    })),
    sha: async (_t, c) => shaOf(c),
    warn: (m) => warns.push(m),
  });

const as = <T>(t: string, u: string, fn: (r: SignSessionRepo) => Promise<T>) =>
  withPackScope(db, { packKey: "contracts", tenantId: t, userId: u }, (tx: Tx) =>
    fn(signSessionRepo(tx, t)),
  );
const statusOf = async (id: string) =>
  (await o<{ status: string }[]>`select status from contracts.contracts where id = ${id}::uuid`)[0]
    ?.status;
const sessionRow = async (id: string) =>
  (
    await o`select status, from_signed_at, to_signed_at, cancel_side, cancel_reason
      from hub.partner_sign_sessions where id = ${id}::uuid`
  )[0];

let seq = 0;
/** A gửi HĐ PROCESSING kèm đề nghị ký cùng lúc → B nhận ⇒ HĐ nhận gắn phiên → B đồng ý. */
async function scenario(): Promise<{ a: string; b: string; s: string }> {
  seq += 1;
  const [a] = (await contracts(o, A, 1, {
    from: 1700 + seq,
    createdBy: UA,
    status: "processing",
  })) as [string];
  const s = await withPackScope(
    db,
    { packKey: "contracts", tenantId: A, userId: UA },
    async (tx: Tx) => {
      const [m] = await tx.execute<{
        id: string;
      }>(sql`select hub.partner_send(${A}::uuid, ${B}::uuid,
        null, 'platform', ${a}, ${JSON.stringify({ title: `HĐ P2b ${seq}`, sign_together: { reason: "gấp", accept_h: 2, sign_h: 4 } })}::jsonb,
        null, ${SHA}, now() + interval '7 days', null)::text as id`);
      return signSessionRepo(tx, A).propose({
        contractId: a,
        mailboxId: m?.id as string,
        reason: "gấp",
        acceptH: 2,
        signH: 4,
        pdfSha256: SHA,
      });
    },
  );
  expect(await receiveInbox(db)(B, 100)).toBe(1);
  const [b] = await o<
    { id: string }[]
  >`select contract_id::text as id from contracts.sign_session_refs
    where tenant_id = ${B} and session_id = ${s}::uuid and side = 'to'`;
  expect(await as(B, UB, (r) => r.accept(s, "Bà B"))).toBe("accepted");
  await move();
  return { a, b: b?.id as string, s };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1707)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1707 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1708 })) as [string];
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  await o`insert into contracts.partner_settings (tenant_id, signer_group_id) values (${B}, gen_random_uuid())`;
  db = connectDb(urls().hubApi, 4);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 P2b · phong bì ký xong ⇄ phiên ký chung", () => {
  it("A ký ⇒ from_signed_at (signing); B ký ⇒ done + sign.session.done + HĐ hai bên done; ký lại ⇒ bỏ qua", async () => {
    const { a, b, s } = await scenario();
    expect(await signed()(A, a)).toBe("signing");
    const r1 = await sessionRow(s);
    expect(r1?.status).toBe("signing");
    expect(r1?.from_signed_at).not.toBeNull();
    expect(r1?.to_signed_at).toBeNull();
    expect(await signed()(B, b)).toBe("done");
    await move();
    expect(signals.filter((x) => x[2] === "sign.session.done").map((x) => x[1])).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect([await statusOf(a), await statusOf(b)]).toEqual(["done", "done"]);
    expect(await signed()(A, a)).toBeNull();
    expect(ended.some((x) => x[1] === a || x[1] === b)).toBe(false);
  });

  it("HĐ không có phiên ⇒ null; văn bản lệch hash ⇒ null + cảnh báo, phiên không đổi", async () => {
    const [lone] = (await contracts(o, A, 1, { from: 1790, createdBy: UA })) as [string];
    expect(await signed()(A, lone)).toBeNull();
    const { a, s } = await scenario();
    shaOf = () => "d".repeat(64);
    try {
      expect(await signed()(A, a)).toBeNull();
    } finally {
      shaOf = () => SHA;
    }
    expect(warns).toContain("sign-session-mark-failed");
    expect((await sessionRow(s))?.status).toBe("accepted");
  });

  it("#14a B huỷ phiên ⇒ cancel_side/cancel_reason + huỷ phong bì HĐ hai bên + sign.session.cancelled", async () => {
    const { a, b, s } = await scenario();
    expect(await signed()(A, a)).toBe("signing");
    expect(await as(B, UB, (r) => r.cancel(s, "Sai phụ lục"))).toBe("cancelled");
    await move();
    expect(await sessionRow(s)).toMatchObject({
      status: "cancelled",
      cancel_side: "to",
      cancel_reason: "Sai phụ lục",
    });
    expect(ended).toEqual(
      expect.arrayContaining([
        [A, a],
        [B, b],
      ]),
    );
    expect(signals.filter((x) => x[2] === "sign.session.cancelled").map((x) => x[1])).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect([await statusOf(a), await statusOf(b)]).toEqual(["draft", "draft"]);
  });

  it("P2c · readFacts: HĐ nhận có phiên ⇒ sign_together=true; HĐ bên gửi / phiên về xử lý bình thường ⇒ false", async () => {
    const facts = contractsFactsReader(db);
    const { a, b, s } = await scenario();
    expect(await facts.read(B, b, ["sign_together"])).toEqual({ sign_together: true });
    expect(await facts.read(A, a, ["sign_together"])).toEqual({ sign_together: false });
    await o`update hub.partner_sign_sessions set status = 'fallback' where id = ${s}::uuid`;
    expect(await facts.read(B, b, ["sign_together"])).toEqual({ sign_together: false });
  });
});
