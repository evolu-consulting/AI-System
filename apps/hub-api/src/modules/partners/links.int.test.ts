// CR-124 · q2 · FLOW4-FR-06 · spec §5 · hub 0118 nối đối tác: request/accept/block/mine. Role thật `hub_api` (scope user).
// Chỉ bên NHẬN (to_tenant = tenant hiện tại) chấp nhận/chặn; sai bên ⇒ 42501; bên nhận phải bật "cho phép tìm thấy".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

const A = tenantId(1401);
const B = tenantId(1402);
const C = tenantId(1403);
const UA = userId(1401);
let o: Sql;

const as = <T>(t: string, fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: t, userId: UA }, fn);
const request = (tx: Sql, to: string) =>
  tx`select hub.partner_link_request(${to}::uuid) as s`.then((r) => r[0]?.s as string);
const accept = (tx: Sql, from: string) =>
  tx`select hub.partner_link_accept(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const block = (tx: Sql, from: string) =>
  tx`select hub.partner_link_block(${from}::uuid) as ok`.then((r) => r[0]?.ok as boolean);
const send = (tx: Sql, from: string, to: string) =>
  tx`select hub.partner_send(${from}::uuid, ${to}::uuid, null, 'platform', 'r', '{}'::jsonb, null, null,
    now() + interval '7 days', null)::text as id`.then((r) => r[0]?.id as string);
const link = (from: string, to: string) =>
  o<{ accepted_at: Date | null; blocked_at: Date | null }[]>`
    select accepted_at, blocked_at from hub.partner_links where from_tenant = ${from} and to_tenant = ${to}`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  // Hồ sơ công ty (admin.tenants): B bật danh bạ, C chưa bật.
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed, directory_verified_at, directory_verified_by)
    values (${A}, 'q2-a', 'A', 'Công ty A', '0100000001', true, null, null),
           (${B}, 'q2-b', 'B', 'Công ty B', '0100000002', true, null, null),
           (${C}, 'q2-c', 'C', 'Công ty C', '0100000003', false, null, null)`;
});
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-124 q2 · nối đối tác (consent một lần)", () => {
  it("request: cần B bật danh bạ, gọi lại không đổi, chưa chấp nhận thì chưa gửi được", async () => {
    expect(await pgCode(() => as(A, (tx) => request(tx, C)))).toBe("42501"); // C chưa bật
    expect(await pgCode(() => as(A, (tx) => request(tx, A)))).toBe("22023"); // tự nối
    expect(await as(A, (tx) => request(tx, B))).toBe("pending");
    expect(await as(A, (tx) => request(tx, B))).toBe("pending");
    expect(await pgCode(() => as(A, (tx) => send(tx, A, B)))).toBe("42501");
    expect(await pgCode(() => inHub("none", (tx) => request(tx, B)))).toBe("42501");
  });

  it("accept/block CHỈ bên nhận, sai bên hoặc không có lời mời ⇒ 42501 và không đổi gì", async () => {
    // A tự chấp nhận lời mời của chính mình, C (bên thứ ba), và B chấp nhận khi chưa có lời mời từ C ⇒ 42501.
    expect(await pgCode(() => as(A, (tx) => accept(tx, A)))).toBe("42501");
    expect(await pgCode(() => as(C, (tx) => accept(tx, A)))).toBe("42501");
    expect(await pgCode(() => as(B, (tx) => accept(tx, C)))).toBe("42501");
    // A "chặn" chỉ tạo dòng (B → A) của chính A; không đụng dòng (A → B).
    await as(A, (tx) => block(tx, B));
    expect((await link(A, B))[0]?.accepted_at).toBeNull();
    expect((await link(A, B))[0]?.blocked_at).toBeNull();
    expect((await link(B, A))[0]?.blocked_at).not.toBeNull();
    await o`delete from hub.partner_links where from_tenant = ${B} and to_tenant = ${A}`;

    expect(await as(B, (tx) => accept(tx, A))).toBe(true);
    expect(await as(B, (tx) => accept(tx, A))).toBe(false); // idempotent
    expect((await link(A, B))[0]?.accepted_at).not.toBeNull();
    // Nối xong: A gửi được (partner_send 0117 thấy dòng đã chấp nhận).
    expect(await as(A, (tx) => send(tx, A, B))).toBeTruthy();
  });

  it("block: B chặn A ⇒ A không gửi được, request trả blocked, B bỏ chặn bằng accept, mine thấy đúng phía", async () => {
    expect(await as(B, (tx) => block(tx, A))).toBe(true);
    expect(await as(B, (tx) => block(tx, A))).toBe(false);
    expect(await as(A, (tx) => request(tx, B))).toBe("blocked");
    expect(await pgCode(() => as(A, (tx) => send(tx, A, B)))).toBe("42501");

    const outA = await as(A, (tx) => tx`select * from hub.partner_links_mine()`);
    expect(outA).toHaveLength(1);
    expect(Object.keys(outA[0] ?? {}).sort()).toEqual(
      [
        "created_at",
        "decided_at",
        "direction",
        "other_name",
        "other_tax_code",
        "other_tenant",
        "other_verified",
        "status",
      ].sort(),
    );
    expect(outA[0]).toMatchObject({
      direction: "out",
      other_tenant: B,
      other_name: "Công ty B",
      status: "blocked",
    });
    const inB = await as(B, (tx) => tx`select * from hub.partner_links_mine()`);
    expect(inB[0]).toMatchObject({
      direction: "in",
      other_tenant: A,
      other_name: "Công ty A",
      status: "blocked",
    });
    expect((await as(C, (tx) => tx`select * from hub.partner_links_mine()`)).length).toBe(0);

    expect(await as(B, (tx) => accept(tx, A))).toBe(true); // bỏ chặn
    expect(await as(A, (tx) => send(tx, A, B))).toBeTruthy();
    // Bảng không đọc/ghi thẳng được từ scope user.
    expect((await as(A, (tx) => tx`select 1 from hub.partner_links`)).length).toBe(0);
    expect(
      await pgCode(() => as(A, (tx) => tx`update hub.partner_links set accepted_at = now()`)),
    ).toBe("42501");
  });
});
