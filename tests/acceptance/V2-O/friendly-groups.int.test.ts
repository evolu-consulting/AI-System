// friendly-groups · migration 0022: chỉ đổi tên Group vai còn đúng mặc định cũ; tên admin đã đổi được giữ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { type World, world } from "../V2-B/_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2703 });
}, 120_000);
afterAll(async () => {
  await w?.stop();
});

describe("friendly-groups · 0022_friendly_group_names", () => {
  it("đổi contracts-owner còn tên cũ; giữ contracts-viewer admin đã đổi; chạy lại không đổi thêm", async () => {
    await w.sql`delete from admin.groups where tenant_id = ${w.A} and key like 'contracts-%'`;
    await w.sql`insert into admin.groups (tenant_id, key, name) values
      (${w.A}, 'contracts-owner', '{"vi":"contracts · Chủ sở hữu"}'::jsonb),
      (${w.A}, 'contracts-viewer', '{"vi":"Kế toán xem HĐ"}'::jsonb)`;
    const sqlText = readFileSync(
      new URL("../../../packages/db/migrations/0022_friendly_group_names.sql", import.meta.url),
      "utf8",
    );
    await w.sql.unsafe(sqlText);
    await w.sql.unsafe(sqlText);
    const rows = await w.sql<{ key: string; vi: string; en: string | null; v: number }[]>`
      select key, name ->> 'vi' as vi, name ->> 'en' as en, version as v from admin.groups
      where tenant_id = ${w.A} and key like 'contracts-%' order by key`;
    expect(rows.map((r) => `${r.key}=${r.vi}`)).toEqual([
      "contracts-owner=Sổ Hợp Tác – Toàn quyền",
      "contracts-viewer=Kế toán xem HĐ",
    ]);
    expect(rows[0]?.en).toBe("Contract Book – Full access");
    expect(rows[0]?.v).toBe(2);
  });
});
