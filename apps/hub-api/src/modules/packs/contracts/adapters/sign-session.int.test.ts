// CR-127 · P1 · BR-60…65 · spec §2.4, §3 #12–#14c — phiên ký chung, HAI công ty thật (A gửi, B nhận), DB thật (role gói contracts_rw,
// hàm DEFINER hub, bộ chuyển hộp thư scope system): cả hai ký ⇒ done hai bên; một bên từ chối ⇒ reject hai bên; huỷ phiên ⇒ draft hai bên;
// quá hạn ký ⇒ chờ bên gửi chọn Gửi lại (draft) / Dừng (reject); hết hạn trả lời ⇒ fallback (HĐ giữ nguyên, luồng thường); văn bản lệch hash
// ⇒ SESSION_HASH_MISMATCH; công ty C không đọc/ghi được phiên; chạy lại bộ chuyển ⇒ idempotent; pha phiên ký 2 câu SQL mỗi lô (Luật 4c).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql } from "@ai/test-kit/perf";
import { sql } from "drizzle-orm";
import { connectDb, type Db } from "../../../../lib/db";
import { partnerMoveOnce } from "../../../partners/mailbox-mover";
import type { PackRunsBridge, PartnerMailboxPort } from "../../kit/public";
import { signSessionErrorOf } from "../domain/sign-session.rules";
import { onSignSessions, receiveInbox } from "../partner-mailbox.mount";
import { type SignSessionRepo, signSessionRepo } from "./sign-session.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let C = "";
let UA = "";
let UB = "";
let UC = "";
const SHA = "a".repeat(64);
const signals: [string, string, string][] = [];
const bridge = {
  port: {
    signalEvent: async (t: string, ref: { record_id: string }, ev: string) => {
      signals.push([t, ref.record_id, ev]);
      return 0;
    },
  },
} as unknown as PackRunsBridge;
const port = (): PartnerMailboxPort => ({
  receive: async () => 0,
  onReplies: async () => {},
  onSignSessions: onSignSessions(db, () => bridge),
});
const move = () => partnerMoveOnce({ db, port });

const as = <T>(t: string, u: string, fn: (r: SignSessionRepo, tx: Tx) => Promise<T>) =>
  withPackScope(db, { packKey: "contracts", tenantId: t, userId: u }, (tx: Tx) =>
    fn(signSessionRepo(tx, t), tx),
  );
const errOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => signSessionErrorOf(e) ?? `${e} ${(e as { cause?: unknown }).cause}`,
  );
const statusOf = async (id: string) =>
  (await o<{ status: string }[]>`select status from contracts.contracts where id = ${id}::uuid`)[0]
    ?.status;
const sessionRow = async (id: string) =>
  (
    await o`select status, expire_choice, emitted_from, emitted_to from hub.partner_sign_sessions where id = ${id}::uuid`
  )[0];

let seq = 0;
/** A có HĐ PROCESSING → gửi qua nền tảng kèm đề xuất ký cùng lúc (cùng tx) → B nhận lô ⇒ HĐ nhận PROCESSING gắn phiên. */
async function scenario(): Promise<{ a: string; b: string; s: string }> {
  seq += 1;
  const [a] = (await contracts(o, A, 1, {
    from: 1600 + seq,
    createdBy: UA,
    status: "processing",
  })) as [string];
  const s = await as(A, UA, async (r, tx) => {
    const [m] = await tx.execute<{
      id: string;
    }>(sql`select hub.partner_send(${A}::uuid, ${B}::uuid, null,
      'platform', ${a}, ${JSON.stringify({ title: `HĐ ký chung ${seq}`, sign_together: { reason: "gấp", accept_h: 2, sign_h: 4 } })}::jsonb,
      null, ${SHA}, now() + interval '7 days', null)::text as id`);
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
  expect(b?.id).toBeTruthy();
  expect(await statusOf(a)).toBe("processing");
  expect(await statusOf(b?.id as string)).toBe("processing");
  return { a, b: b?.id as string, s };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, C] = (await tenants(o, 3, 1607)) as [string, string, string];
  [UA] = (await users(o, A, 1, { from: 1607 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1608 })) as [string];
  [UC] = (await users(o, C, 1, { from: 1609 })) as [string];
  await o`update admin.tenants set legal_name = 'Công ty A' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B' where id = ${B}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values (${A}, ${B}, now(), now())`;
  // P2 · bên nhận có nhóm «Người ký HĐ» (không có ⇒ đề nghị tự về xử lý bình thường)
  await o`insert into contracts.partner_settings (tenant_id, signer_group_id) values (${B}, gen_random_uuid())`;
  db = connectDb(urls().hubApi, 4);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 P1 · phiên ký chung hai công ty", () => {
  it("#12 cả hai ký đúng văn bản ⇒ DONE hai bên; bên kia chỉ thấy tên công ty + người ký; chạy lại bộ chuyển không đổi gì", async () => {
    const { a, b, s } = await scenario();
    expect(await as(B, UB, (r) => r.accept(s, "Bà B"))).toBe("accepted");
    await move();
    expect(signals.filter((x) => x[2] === "sign.session.accepted").map((x) => x[1])).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(await as(A, UA, (r) => r.markSigned(s, "Ông A", SHA))).toBe("signing");
    expect(await as(B, UB, (r) => r.markSigned(s, null, SHA))).toBe("done");
    const view = await as(B, UB, (r) => r.mine(s));
    expect(view).toMatchObject({
      side: "to",
      status: "done",
      from_company: "Công ty A",
      from_signer_name: "Ông A",
      to_company: "Công ty B",
      to_signer_name: "Bà B",
    });
    expect(JSON.stringify(view)).not.toContain(A);
    await move();
    expect([await statusOf(a), await statusOf(b)]).toEqual(["done", "done"]);
    expect(await sessionRow(s)).toMatchObject({ emitted_from: true, emitted_to: true });
    const n = signals.length;
    await move();
    expect(signals.length).toBe(n);
    // đã ký xong ⇒ ký lại idempotent, huỷ không được
    expect(await as(A, UA, (r) => r.markSigned(s, "Ông A", SHA))).toBe("done");
    expect(await errOf(as(A, UA, (r) => r.cancel(s, "muộn")))).toBe("SESSION_NOT_ACTIVE");
  });

  it("văn bản ký khác bản đã thống nhất ⇒ SESSION_HASH_MISMATCH; B từ chối ký ⇒ REJECT hai bên", async () => {
    const { a, b, s } = await scenario();
    await as(B, UB, (r) => r.accept(s, "Bà B"));
    expect(await errOf(as(A, UA, (r) => r.markSigned(s, "Ông A", "b".repeat(64))))).toBe(
      "SESSION_HASH_MISMATCH",
    );
    expect(await as(B, UB, (r) => r.decline(s, "Không đồng ý điều 5"))).toBe("declined");
    await move();
    expect([await statusOf(a), await statusOf(b)]).toEqual(["reject", "reject"]);
    expect(await as(A, UA, (r) => r.mine(s))).toMatchObject({
      cancel_side: "to",
      cancel_reason: "Không đồng ý điều 5",
    });
  });

  it("#14a huỷ phiên ⇒ bên gửi DRAFT, bên nhận DRAFT (chờ bản sửa)", async () => {
    const { a, b, s } = await scenario();
    await as(B, UB, (r) => r.accept(s, "Bà B"));
    await as(A, UA, (r) => r.markSigned(s, "Ông A", SHA));
    expect(await as(B, UB, (r) => r.cancel(s, "Sai phụ lục"))).toBe("cancelled");
    await move();
    expect([await statusOf(a), await statusOf(b)]).toEqual(["draft", "draft"]);
    const [ev] = await o`select data from contracts.contract_events
      where contract_id = ${b}::uuid and type = 'status_changed' and data->>'ev' = 'sign_session_cancelled'`;
    expect(ev?.data).toMatchObject({ ev: "sign_session_cancelled", to: "draft" });
  });

  it("#14b quá hạn ký ⇒ expired (HĐ giữ nguyên, báo hai bên); chỉ bên gửi chọn; Gửi lại ⇒ DRAFT hai bên", async () => {
    const { a, b, s } = await scenario();
    await as(B, UB, (r) => r.accept(s, "Bà B"));
    await move();
    await o`update hub.partner_sign_sessions set sign_deadline_at = now() - interval '1 second' where id = ${s}::uuid`;
    expect(await errOf(as(A, UA, (r) => r.markSigned(s, "Ông A", SHA)))).toBe("SESSION_NOT_ACTIVE");
    await move();
    expect(await sessionRow(s)).toMatchObject({ status: "expired", emitted_from: true });
    expect([await statusOf(a), await statusOf(b)]).toEqual(["processing", "processing"]);
    expect(signals.filter((x) => x[2] === "sign.session.expired").map((x) => x[1])).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(await errOf(as(B, UB, (r) => r.resolve(s, "stop")))).toBe("SESSION_FORBIDDEN");
    expect(await as(A, UA, (r) => r.resolve(s, "resend"))).toBe("resend");
    await move();
    expect([await statusOf(a), await statusOf(b)]).toEqual(["draft", "draft"]);
  });

  it("#14c quá hạn ký + Dừng ⇒ REJECT hai bên", async () => {
    const { a, b, s } = await scenario();
    await as(B, UB, (r) => r.accept(s, "Bà B"));
    await o`update hub.partner_sign_sessions set sign_deadline_at = now() - interval '1 second' where id = ${s}::uuid`;
    await move();
    expect(await as(A, UA, (r) => r.resolve(s, "stop"))).toBe("stop");
    await move();
    expect([await statusOf(a), await statusOf(b)]).toEqual(["reject", "reject"]);
  });

  it("B hết hạn trả lời ⇒ fallback: HĐ hai bên giữ PROCESSING (luồng thường), không đồng ý muộn được", async () => {
    const { a, b, s } = await scenario();
    await o`update hub.partner_sign_sessions set accept_deadline_at = now() - interval '1 second' where id = ${s}::uuid`;
    await move();
    expect(await sessionRow(s)).toMatchObject({ status: "fallback" });
    expect([await statusOf(a), await statusOf(b)]).toEqual(["processing", "processing"]);
    expect(await errOf(as(B, UB, (r) => r.accept(s, "Bà B")))).toBe("SESSION_NOT_ACTIVE");
  });

  it("cách ly: công ty C không đọc/ghi phiên, không thấy liên kết, không đọc thẳng bảng hub", async () => {
    const { s } = await scenario();
    for (const f of [
      (r: SignSessionRepo) => r.accept(s, "C"),
      (r: SignSessionRepo) => r.cancel(s, "C"),
      (r: SignSessionRepo) => r.decline(s, "C"),
      (r: SignSessionRepo) => r.markSigned(s, "C", SHA),
    ])
      expect(await errOf(as(C, UC, f))).toBe("SESSION_FORBIDDEN");
    expect(await as(C, UC, (r) => r.mine(s))).toBeNull();
    expect(await as(C, UC, (r) => r.refsFor([s]))).toEqual([]);
    expect(
      await errOf(
        as(C, UC, (_r, tx) => tx.execute(sql`select id from hub.partner_sign_sessions limit 1`)),
      ),
    ).toContain("permission denied");
    // B không đề xuất được thay A
    const [m] = await o<
      { id: string }[]
    >`select mailbox_id::text as id from hub.partner_sign_sessions where id = ${s}::uuid`;
    expect(
      await errOf(
        as(B, UB, (r) =>
          r.propose({
            contractId: crypto.randomUUID(),
            mailboxId: m?.id as string,
            reason: null,
            acceptH: 2,
            signH: 4,
            pdfSha256: SHA,
          }),
        ),
      ),
    ).toBe("SESSION_FORBIDDEN");
  });

  it("perf: pha phiên ký 2 câu SQL mỗi lô, không phụ thuộc số phiên", async () => {
    const noop: PartnerMailboxPort = { ...port(), onSignSessions: async () => {} };
    const run = () => partnerMoveOnce({ db, port: () => noop });
    const touch = (n: number) => o`update hub.partner_sign_sessions set emitted_from = false
      where id in (select id from hub.partner_sign_sessions order by created_at limit ${n})`;
    await run();
    await touch(1);
    const small = (await captureSql((db.db as unknown as { $client: Sql }).$client, run)).queries;
    await touch(6);
    const big = (await captureSql((db.db as unknown as { $client: Sql }).$client, run)).queries;
    const ss = (q: { text: string }[]) => q.filter((x) => x.text.includes("partner_sign_sessions"));
    console.log(`perf sign-session mover: câu/lô 1 phiên=${small.length} 6 phiên=${big.length}`);
    expect(ss(small)).toHaveLength(2);
    expect(ss(big)).toHaveLength(2);
    expect(big.length).toBe(small.length);
  });
});
