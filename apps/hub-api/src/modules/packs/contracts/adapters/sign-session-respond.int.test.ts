// fix-review-r2 · `POST /contracts/:id/sign-session/respond` (bên NHẬN trả lời đề nghị ký cùng lúc) — route thật + DB thật, hai công ty (A gửi, B/C nhận).
// 4 ca: người ký ngoài bước Ký của quy trình Nhận HĐ ⇒ 422 SIGNER_NOT_IN_GROUP; quy trình Nhận HĐ không có bước Ký ⇒ 422 NO_SIGN_NODE;
// người không phải phụ trách HĐ / quản trị ⇒ 403 FORBIDDEN; N2: người ký ĐƯỢC GIAO (không phải người tạo HĐ, không phải người bấm trả lời) ký được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { withPackScope } from "@ai/db/pack-scope";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { receiveInbox } from "../partner-mailbox.mount";
import { signSessionRoutes } from "../sign-session.routes";
import { signSessionRepo } from "./sign-session.repo";
import { receiveFlowFixture } from "./test/receive-flow.fixture";

let o: Sql;
let db: Db;
let app: Hono<PackGuardVars>;
let A = "";
let B = "";
let C = "";
let D = "";
let UDgone = "";
let UDadmin = "";
let UA = "";
let UBown = "";
let UBsign = "";
let UBother = "";
let UBadmin = "";
let UCown = "";
const SHA = "b".repeat(64);
const WHO = new Map<string, { userId: string; tenantId: string; role: Role }>();

const F = { r: "f-r", w: "f-w", a: "f-a" };
/** Cổng quyền giả: `g-w` = đọc/ghi gói Hợp đồng, `g-a` = thêm Toàn quyền (admin). */
const view = (tenantIds: string[], groups: Map<string, string[]>): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: F.r, key: "contracts-read", status: "on" },
      { id: F.w, key: "contracts-write", status: "on" },
      { id: F.a, key: "contracts-admin", status: "on" },
    ],
    entitled: new Set(tenantIds.flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
    grantGroups: new Map(
      tenantIds.flatMap((t) => [
        [`${t}:${F.r}`, ["g-w", "g-a"]],
        [`${t}:${F.w}`, ["g-w", "g-a"]],
        [`${t}:${F.a}`, ["g-a"]],
      ]),
    ) as never,
  }),
  user: async (id) => {
    const w = WHO.get(id);
    return w ? { tenantId: w.tenantId, groupIds: new Set(groups.get(id) ?? []) } : undefined;
  },
});

async function respond(who: string, contractId: string, body: object) {
  const r = await app.request(`/contracts/${contractId}/sign-session/respond`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-who": who },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const j = (text ? JSON.parse(text) : {}) as { error?: { code?: string }; code?: string };
  return { status: r.status, code: j.error?.code ?? j.code ?? "ok" };
}

let seq = 0;
/** A gửi HĐ kèm đề nghị ký cùng lúc tới `to` ⇒ `to` nhận lô ⇒ id HĐ nhận + id phiên. */
async function scenario(to: string): Promise<{ b: string; s: string }> {
  seq += 1;
  const [a] = (await contracts(o, A, 1, {
    from: 1700 + seq,
    createdBy: UA,
    status: "processing",
  })) as [string];
  const s = await withPackScope(
    db,
    { packKey: "contracts", tenantId: A, userId: UA },
    async (tx) => {
      const [m] = await tx.execute<{
        id: string;
      }>(sql`select hub.partner_send(${A}::uuid, ${to}::uuid, null,
      'platform', ${a}, ${JSON.stringify({ title: `HĐ ký chung ${seq}`, sign_together: { reason: "gấp", accept_h: 2, sign_h: 4 } })}::jsonb,
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
  expect(await receiveInbox(db)(to, 100)).toBe(1);
  const [b] = await o<
    { id: string }[]
  >`select contract_id::text as id from contracts.sign_session_refs
    where tenant_id = ${to} and session_id = ${s}::uuid and side = 'to'`;
  return { b: b?.id as string, s };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, C, D] = (await tenants(o, 4, 1700)) as [string, string, string, string];
  [UA] = (await users(o, A, 1, { from: 1700 })) as [string];
  [UBown, UBsign, UBother, UBadmin] = (await users(o, B, 4, { from: 1710 })) as [
    string,
    string,
    string,
    string,
  ];
  [UCown] = (await users(o, C, 1, { from: 1720 })) as [string];
  [UDgone, UDadmin] = (await users(o, D, 2, { from: 1730 })) as [string, string];
  await o`update admin.users set active = false where id = ${UDgone}`; // người phụ trách đã nghỉ
  await o`update admin.users set role = 'tenant_admin' where id = ${UDadmin}`;
  await o`update admin.tenants set legal_name = 'Công ty A' where id = ${A}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at)
    values (${A}, ${B}, now(), now()), (${A}, ${C}, now(), now()), (${A}, ${D}, now(), now())`;
  // B: quy trình Nhận HĐ có bước Ký (người ký = UBsign), người phụ trách = UBown. C: quy trình Nhận HĐ KHÔNG có bước Ký.
  await receiveFlowFixture(o, B, { signers: `user:${UBsign}`, params: { owner_user_id: UBown } });
  await receiveFlowFixture(o, C, { params: { owner_user_id: UCown } });
  await receiveFlowFixture(o, D, { params: { owner_user_id: UDgone } });
  for (const [u, t] of [
    [UBown, B],
    [UBsign, B],
    [UBother, B],
    [UBadmin, B],
    [UCown, C],
  ] as const)
    WHO.set(u, { userId: u, tenantId: t, role: "member" });
  db = connectDb(urls().hubApi, 4);
  const groups = new Map<string, string[]>([
    [UBown, ["g-w"]],
    [UBsign, ["g-w"]],
    [UBother, ["g-w"]],
    [UBadmin, ["g-a"]],
    [UCown, ["g-w"]],
  ]);
  app = new Hono<PackGuardVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO.get(c.req.header("x-who") ?? "") as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const uow = createPackUow(db, "contracts", (tx, tid) => ({ tx, tid }));
  app.route("/", signSessionRoutes(db, view([B, C], groups), uow));
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("fix-review-r2 · POST /contracts/:id/sign-session/respond", () => {
  it("người ký không nằm trong bước Ký của quy trình Nhận HĐ ⇒ 422 SIGNER_NOT_IN_GROUP", async () => {
    const { b } = await scenario(B);
    expect(await respond(UBown, b, { choice: "accept", signer_user_id: UBother })).toEqual({
      status: 422,
      code: "SIGNER_NOT_IN_GROUP",
    });
  });

  it("thiếu người ký khi Đồng ý ⇒ 422 SIGNER_REQUIRED", async () => {
    const { b } = await scenario(B);
    expect(await respond(UBown, b, { choice: "accept" })).toEqual({
      status: 422,
      code: "SIGNER_REQUIRED",
    });
  });

  it("quy trình Nhận HĐ không có bước Ký ⇒ 422 NO_SIGN_NODE", async () => {
    const { b } = await scenario(C);
    expect(await respond(UCown, b, { choice: "accept", signer_user_id: UCown })).toEqual({
      status: 422,
      code: "NO_SIGN_NODE",
    });
  });

  it("người không phải phụ trách HĐ / quản trị ⇒ 403 FORBIDDEN, phiên không đổi", async () => {
    const { b, s } = await scenario(B);
    expect(await respond(UBother, b, { choice: "accept", signer_user_id: UBsign })).toEqual({
      status: 403,
      code: "FORBIDDEN",
    });
    const [r] = await o<
      { status: string }[]
    >`select status from hub.partner_sign_sessions where id = ${s}::uuid`;
    expect(r?.status).toBe("proposed");
  });

  it("N2 · người ký được giao (khác người tạo HĐ, khác người bấm trả lời) ⇒ Đồng ý được, phiên ghi tên người ký đó; quản trị cũng trả lời được", async () => {
    const one = await scenario(B);
    expect(await respond(UBown, one.b, { choice: "accept", signer_user_id: UBsign })).toEqual({
      status: 200,
      code: "ok",
    });
    const [r] = await o<
      { status: string; n: string | null }[]
    >`select status, to_signer_name as n from hub.partner_sign_sessions where id = ${one.s}::uuid`;
    expect(r?.status).toBe("accepted");
    const [u] = await o<
      { n: string }[]
    >`select display_name as n from admin.users where id = ${UBsign}::uuid`;
    expect(r?.n).toBe(u?.n as string);
    const two = await scenario(B);
    expect(await respond(UBadmin, two.b, { choice: "normal" })).toEqual({
      status: 200,
      code: "ok",
    });
  });
});

describe("fix-review-r2 · lúc nhận HĐ, người phụ trách không còn dùng được", () => {
  const ownerOf = async (cid: string) =>
    (
      await o<
        { owner: string | null }[]
      >`select owner_user_id::text as owner from contracts.contracts where id = ${cid}::uuid`
    )[0]?.owner;
  it("người phụ trách còn dùng được ⇒ ghi vào HĐ nhận", async () => {
    const { b } = await scenario(B);
    expect(await ownerOf(b)).toBe(UBown);
  });
  it("người phụ trách đã nghỉ ⇒ owner_user_id = null (HĐ vẫn vào), KHÔNG đổi sang quản trị", async () => {
    const { b } = await scenario(D);
    expect(await ownerOf(b)).toBeNull();
    expect(UDadmin).not.toBe(UDgone);
  });
});
