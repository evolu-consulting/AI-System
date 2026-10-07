// HUB-FR-96 · seed dev phòng (test-plan X2a §5.2 Z01; plan-db §4.6, tasks B8): DM `lan`–`hoa` (3 tin) + nhóm "Nhóm dự án"
// (`lan` chủ, `hoa`) 2 tin; idempotent theo id cố định; `last_seq` khớp `max(seq)`. Seam (test-plan §9 G13):
// `tools/hub-dev/src/fixture-rooms.ts` export `ensureFixtureRooms(ownerUrl: string): Promise<void>` (tra tenant `acme`,
// user theo username). Nạp động (file chưa có ⇒ đỏ "Cannot find module" trong ca).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { OWNER_URL } from "../H1/_fixtures";
import { ROOT } from "./_modules";
import { P, type Sql, setupX2a } from "./_x2a";

let sql: Sql;
beforeAll(async () => {
  sql = await setupX2a();
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

async function snapshot(): Promise<unknown> {
  const rooms = await sql`select r.kind, r.name, r.last_seq::int as last_seq,
      (select coalesce(max(seq), 0)::int from hub.room_messages m where m.room_id = r.id) as max_seq,
      (select count(*)::int from hub.room_messages m where m.room_id = r.id) as n,
      (select array_agg(user_id::text || ':' || role order by user_id) from hub.room_members x where x.room_id = r.id) as mem
    from hub.rooms r order by r.kind, r.name`;
  return JSON.parse(JSON.stringify(rooms));
}

describe("Z01 · seed dev phòng [plan-db §4.6]", () => {
  it('HUB-FR-96 · Z01 · ensureFixtureRooms chạy 2 lần ⇒ cùng số hàng; DM lan–hoa 3 tin, nhóm "Nhóm dự án" 2 tin; last_seq = max(seq)', async () => {
    const mod = await import(join(ROOT, "tools/hub-dev/src/fixture-rooms.ts"));
    await mod.ensureFixtureRooms(OWNER_URL);
    const first = await snapshot();
    await mod.ensureFixtureRooms(OWNER_URL);
    expect(await snapshot()).toEqual(first);
    const rows = first as {
      kind: string;
      name: string | null;
      last_seq: number;
      max_seq: number;
      n: number;
      mem: string[];
    }[];
    const dm = rows.find((r) => r.kind === "dm");
    const grp = rows.find((r) => r.kind === "group" && r.name === "Nhóm dự án");
    expect({ dm: dm?.n, grp: grp?.n }).toEqual({ dm: 3, grp: 2 });
    for (const r of rows) expect(r.last_seq).toBe(r.max_seq);
    expect(dm?.mem.sort()).toEqual([`${P.lan.id}:member`, `${P.hoa.id}:member`].sort());
    expect(grp?.mem.sort()).toEqual([`${P.lan.id}:owner`, `${P.hoa.id}:member`].sort());
  });
});
