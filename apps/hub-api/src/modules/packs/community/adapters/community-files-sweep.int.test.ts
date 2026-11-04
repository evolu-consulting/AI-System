// CR-118 · cr118-r2-server · dọn tệp Community (`community.files`) trên DB thật (RLS gói, role `community_rw`). Viết TRƯỚC code
// (xoá dữ liệu + RLS). Đồng hồ giả (`at`), gọi `sweepFilesOnce` trực tiếp — không sleep. Kho byte giả theo tenant; bật lỗi theo
// fileId để kiểm "FileBox lỗi ⇒ giữ hàng, lượt sau làm lại".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql as dsql } from "drizzle-orm";
import {
  type Cast,
  seedCast,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackSystemUow } from "../../kit/application/ports";
import type { CommunityBlobs } from "../application/pack-ports";
import { type FileSweepDeps, sweepFilesOnce } from "./files.sweep";

let sql: Sql;
let db: Db;
let c: Cast;
const NOW = new Date("2026-11-04T12:00:00.000Z");
const H = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** Kho giả: khoá tenant/fileId; `failing` ⇒ `drop` ném (FileBox 503). */
const store = new Set<string>();
const failing = new Set<string>();
const blobs: CommunityBlobs = {
  put: async () => ({ fileId: "unused", versionId: null }),
  get: async () => null,
  drop: async (t, f) => {
    if (failing.has(f)) throw new Error("filebox delete 503");
    store.delete(`${t}/${f}`);
  },
};

let sqlCount = 0;
/** Bọc uow: đếm câu SQL của pha dọn (mọi `tx.execute` trong `system`). */
function countingUow(u: PackSystemUow<{ tx: Tx }>): PackSystemUow<{ tx: Tx }> {
  return {
    system: (t, fn) =>
      u.system(t, (r) => {
        const tx = new Proxy(r.tx, {
          get(target, p, recv) {
            const v = Reflect.get(target, p, recv);
            if (p !== "execute" || typeof v !== "function") return v;
            return (...a: unknown[]) => {
              sqlCount++;
              return (v as (...x: unknown[]) => unknown).apply(target, a);
            };
          },
        });
        return fn({ ...r, tx });
      }),
  };
}

let deps: FileSweepDeps;

/** Hàng `community.files` của tenant A tạo lúc `created`; byte vào kho giả. */
async function file(key: string, created: string, deleted: string | null = null): Promise<string> {
  const [r] = await sql<{ id: string }[]>`insert into community.files
      (tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by, created_at, deleted_at)
    values (${c.A}, ${`t_${c.A}`}, ${key}, 'v1', ${`${key}.pdf`}, 'application/pdf', 10, ${c.hA},
      ${created}::timestamptz, ${deleted}::timestamptz)
    returning id::text as id`;
  store.add(`${c.A}/${key}`);
  return r?.id as string;
}
async function attach(postId: string, fileId: string): Promise<void> {
  await sql`insert into community.media (tenant_id, post_id, position, kind, label, file_id, name, mime, size_bytes)
    values (${c.A}, ${postId}, 0, 'file', '', ${fileId}, 'x.pdf', 'application/pdf', 10)`;
}
const rowsLeft = async (ids: string[]) =>
  (
    await sql<
      { id: string; marked: boolean }[]
    >`select id::text as id, deleted_at is not null as marked
      from community.files where id = any(${ids}::uuid[]) order by created_at`
  ).map((r) => ({ id: r.id, marked: r.marked }));

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 73);
  db = createDb(urls().hubApi, { max: 2 });
  const uow = createPackUow(db, "community", (tx) => ({ tx }));
  deps = { uow: countingUow(uow), tenants: async () => [c.A], blobs, limit: 2 };
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-118 · dọn tệp Community", () => {
  let oldLoose = "";
  let fresh = "";
  let attached = "";
  let ofDeleted = "";

  it("dọn tệp không gắn, giữ tệp mới và tệp đang gắn", async () => {
    const p = await seedPosts(sql, c.A, [
      { key: "keep-p", type: "sell", org: c.S2, author: c.s2 },
      { key: "gone-p", type: "sell", org: c.S2, author: c.s2 },
    ]);
    oldLoose = await file("fb-old", ago(25 * H));
    fresh = await file("fb-new", ago(23 * H));
    attached = await file("fb-att", ago(48 * H));
    ofDeleted = await file("fb-del", ago(30 * H));
    await attach(p.get("keep-p") as string, attached);
    await attach(p.get("gone-p") as string, ofDeleted);
    await sql`delete from community.posts where id = ${p.get("gone-p") as string}`; // media xoá dây chuyền

    const r = await sweepFilesOnce(deps, NOW);
    expect(r).toEqual({ tenants: 1, swept: 2, failed: 0 });
    expect(await rowsLeft([oldLoose, fresh, attached, ofDeleted])).toEqual([
      { id: attached, marked: false },
      { id: fresh, marked: false },
    ]);
    expect([...store].sort()).toEqual([`${c.A}/fb-att`, `${c.A}/fb-new`]);
    // Chạy lại ⇒ không đổi (idempotent).
    expect(await sweepFilesOnce(deps, NOW)).toEqual({ tenants: 1, swept: 0, failed: 0 });
    expect((await rowsLeft([attached, fresh])).length).toBe(2);
  });

  it("FileBox lỗi ⇒ giữ hàng để làm lại", async () => {
    const bad = await file("fb-bad", ago(26 * H));
    failing.add("fb-bad");
    expect(await sweepFilesOnce(deps, NOW)).toEqual({ tenants: 1, swept: 0, failed: 1 });
    expect(await rowsLeft([bad])).toEqual([{ id: bad, marked: true }]); // đã đánh dấu, hàng còn
    expect(store.has(`${c.A}/fb-bad`)).toBe(true);
    failing.delete("fb-bad");
    expect(await sweepFilesOnce(deps, NOW)).toEqual({ tenants: 1, swept: 1, failed: 0 });
    expect(await rowsLeft([bad])).toEqual([]);
    expect(store.has(`${c.A}/fb-bad`)).toBe(false);
  });

  it("số câu SQL mỗi lô cố định", async () => {
    const measure = async (n: number) => {
      for (let i = 0; i < n; i++) await file(`fb-n${n}-${i}`, ago(40 * H));
      sqlCount = 0;
      const r = await sweepFilesOnce({ ...deps, limit: 50 }, NOW);
      expect(r.swept).toBe(n);
      return sqlCount;
    };
    const one = await measure(1);
    const many = await measure(20);
    expect({ one, many }).toEqual({ one: 2, many: 2 }); // claim (1 tx) + delete (1 tx)
    sqlCount = 0;
    await sweepFilesOnce(deps, NOW); // không có việc ⇒ chỉ câu claim
    expect(sqlCount).toBe(1);
  });

  it("user không xoá cứng được tệp", async () => {
    const mine = await file("fb-user", ago(50 * H), ago(1 * H));
    // Hàng đã đánh dấu, không media — chỉ khác: scope có user ⇒ policy `files_delete` (chỉ hệ thống) chặn ⇒ 0 hàng.
    let n = -1;
    const code = await pgCode(async () => {
      n = (
        await inPackAs(
          "community",
          c.A,
          c.hA,
          (tx) => tx`delete from community.files where id = ${mine}::uuid returning id`,
        )
      ).length;
    });
    expect({ code, n }).toEqual({ code: null, n: 0 });
    expect((await rowsLeft([mine])).length).toBe(1);
    // Scope hệ thống nhưng tệp còn trên bài ⇒ cũng 0 hàng (policy kiểm media).
    const del = await deps.uow.system(
      c.A,
      async ({ tx }) =>
        (await tx.execute(dsql`delete from community.files where id = ${attached}::uuid`)).count,
    );
    expect(del).toBe(0);
  });
});
