// CR-161 · sửa lỗi lát 3 · hub 0148: id FileBox THẬT = 16 ký tự hex (không phải uuid) ⇒ `cc_files.id` uuid do route sinh, id FileBox ở `box_file_id`.
// Tầng DB (role `hub_api`): lưu / đọc / dọn tệp với id dạng 16 hex; id FileBox sai dạng ⇒ CC422; quyền đọc (cặp, chưa gắn chỉ người tải) giữ nguyên.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const A = tenantId(1630);
const B = tenantId(1631);
const E = tenantId(1632); // không quan hệ
const TIEN = userId(1630); // A · Toàn quyền
const DUNG = userId(1631); // B · Toàn quyền (không phải người tải)
const EVA = userId(1632); // E · Toàn quyền
let o: Sql;

const as = <T>(t: string, u: string, fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: t, userId: u }, fn);
const code = async (fn: () => Promise<unknown>): Promise<string | null> =>
  fn().then(
    () => null,
    (e: { code?: string }) => e.code ?? null,
  );
const add = (tx: Sql, other: string, tenant: string, id: string, box: string) =>
  tx`select hub.cc_file_add(${other}::uuid, ${id}::uuid, ${box}, 'hop-dong.pdf', 'application/pdf', 10::bigint, ${`${tenant}/${id}`}) as f`;
const get = (tx: Sql, id: string) =>
  tx<
    { storage_key: string; box_file_id: string }[]
  >`select * from hub.cc_file_get(${id}::uuid)`.then((r) => r.map((x) => ({ ...x })));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'cf-a', 'A', 'NitiGroup', '0100000401', true), (${B}, 'cf-b', 'B', 'Preschool Việt', '0100000402', true),
           (${E}, 'cf-e', 'E', 'Công ty Ê', '0100000403', true)`;
  await users(o, A, 1, { from: 1630 });
  await users(o, B, 1, { from: 1631 });
  await users(o, E, 1, { from: 1632 });
  const g = await enablePack(o, [A, B, E], "contracts");
  await members(o, A, g.get(A)?.owner as string, [TIEN]);
  await members(o, B, g.get(B)?.owner as string, [DUNG]);
  await members(o, E, g.get(E)?.owner as string, [EVA]);
  await as(A, TIEN, (tx) => tx`select hub.cc_invite(${B}::uuid, null, ${TIEN}::uuid, 'Mời')`);
  await as(B, DUNG, (tx) => tx`select hub.partner_link_accept(${A}::uuid)`);
}, 90_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-161 · tệp trò chuyện với id FileBox thật (16 hex)", () => {
  const BOX = "0f3a9c5e7b1d2468";
  it("lưu id 16 hex ⇒ đọc lại đủ khoá + id FileBox; chưa gắn tin: chỉ người tải; người ngoài cặp ⇒ rỗng", async () => {
    const id = randomUUID();
    await as(A, TIEN, (tx) => add(tx, B, A, id, BOX));
    expect(await as(A, TIEN, (tx) => get(tx, id))).toEqual([
      { storage_key: `${A}/${id}`, box_file_id: BOX },
    ]);
    expect(await as(B, DUNG, (tx) => get(tx, id))).toEqual([]); // chưa gắn tin: Dung (không phải người tải) chưa thấy
    expect(await as(E, EVA, (tx) => get(tx, id))).toEqual([]);
    const [r] = await as(
      A,
      TIEN,
      (tx) =>
        tx<
          { seq: string }[]
        >`select seq from hub.cc_send(${B}::uuid, ${randomUUID()}::uuid, 'Tiên', 'kèm tệp', array[${id}]::uuid[])`,
    );
    expect(Number(r?.seq)).toBe(1);
    expect(await as(B, DUNG, (tx) => get(tx, id))).toEqual([
      { storage_key: `${A}/${id}`, box_file_id: BOX },
    ]); // đã gắn tin: người Toàn quyền của B đọc được
    expect(await as(E, EVA, (tx) => get(tx, id))).toEqual([]);
  });

  it("id FileBox sai dạng (rỗng, có '/', quá 64 ký tự) ⇒ CC422 MSG_FILE_INVALID, không ghi dòng", async () => {
    const n0 = (await o`select count(*)::int as n from hub.cc_files`)[0]?.n;
    for (const bad of ["", "a/b", "x".repeat(65), "co dau cach"]) {
      const id = randomUUID();
      expect([bad, await code(() => as(A, TIEN, (tx) => add(tx, B, A, id, bad)))]).toEqual([
        bad,
        "CC422",
      ]);
    }
    expect((await o`select count(*)::int as n from hub.cc_files`)[0]?.n).toBe(n0);
  });

  it("dọn tệp chưa gắn quá hạn trả id FileBox 16 hex (để xoá nội dung); hàng đã soft-delete không còn đọc được", async () => {
    const id = randomUUID();
    const box = "aabbccddeeff0011";
    await as(A, TIEN, (tx) => add(tx, B, A, id, box));
    await o`update hub.cc_files set created_at = now() - interval '30 hours' where id = ${id}`;
    const rows = await inHub({ kind: "system" }, (tx) =>
      tx<
        { file_id: string; storage_key: string; box_file_id: string }[]
      >`select * from hub.cc_files_sweep('24 hours'::interval)`.then((r) =>
        r.map((x) => ({ ...x })),
      ),
    );
    expect(rows).toEqual([{ file_id: id, storage_key: `${A}/${id}`, box_file_id: box }]);
    expect(await as(A, TIEN, (tx) => get(tx, id))).toEqual([]);
  });

  it("GRANT sau đổi chữ ký: hub_rw gọi được cả ba hàm; chữ ký cũ không còn", async () => {
    const old = await o`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'hub' and p.proname = 'cc_file_add' and p.pronargs = 6`;
    expect(old).toHaveLength(0);
    const g = await o<
      { fn: string; ok: boolean }[]
    >`select 'add' as fn, has_function_privilege('hub_rw', 'hub.cc_file_add(uuid,uuid,text,text,text,bigint,text)', 'EXECUTE') as ok
      union all select 'get', has_function_privilege('hub_rw', 'hub.cc_file_get(uuid)', 'EXECUTE')
      union all select 'sweep', has_function_privilege('hub_rw', 'hub.cc_files_sweep(interval)', 'EXECUTE')
      union all select 'pub', has_function_privilege('public', 'hub.cc_file_add(uuid,uuid,text,text,text,bigint,text)', 'EXECUTE')`;
    expect(Object.fromEntries(g.map((r) => [r.fn, r.ok]))).toEqual({
      add: true,
      get: true,
      sweep: true,
      pub: false,
    });
  });
});
