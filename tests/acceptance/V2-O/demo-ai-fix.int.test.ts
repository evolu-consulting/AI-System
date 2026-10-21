// Demo · demo-ai-fix: chạy 2 lần cùng kết quả (lặp lại được), chỉ tenant demo, tên công ty giả, tri thức giả, grant `assistant`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { run } from "../../../tools/scripts/src/demo-ai-fix";
import { seedDemo } from "../../../tools/scripts/src/seed-demo-v2";
import { type World, world } from "../V2-B/_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2702 });
  await w.sql`update admin.tenants set key = 'demo' where id = ${w.A}`;
  await w.sql`update admin.tenants set key = 'nitigroup' where id = ${w.B}`;
  await seedDemo(
    w.sql,
    { tenantId: w.A, tenantKey: "demo", owner: w.boss, editor: w.u1 },
    "2026-10-21",
  );
  // Mô phỏng demo đã nạp bản cũ: tên công ty NITI, đối tác thiếu điện thoại.
  await w.sql`update contracts.company_settings set company_name = 'NITI GROUP' where tenant_id = ${w.A}`;
  await w.sql`insert into admin.groups (tenant_id, key, name) values (${w.A}, 'beta-testers', '{"vi":"Beta testers"}'::jsonb) on conflict do nothing`;
  await w.sql`update admin.users set email = 'demo-owner@example.invalid', display_name = 'demo-owner' where id = ${w.boss}`;
  await w.sql`update contracts.companies set phone = null, contact_person = null where tenant_id = ${w.A}`;
}, 180_000);
afterAll(async () => {
  await w?.stop();
});

describe("demo-ai-fix", () => {
  it("--apply sửa tên công ty, điện thoại đối tác, thêm tri thức (tài liệu demo + QC-TC-01); chạy lại không đổi gì; không đụng tenant khác", async () => {
    const dry = await run(w.sql, false);
    expect(dry).toMatchObject({ company: true, doc: true, policyDoc: true });
    const [pre] = await w.sql<{ n: number }[]>`select count(*)::int as n from knowledge.documents`;
    expect(pre?.n).toBe(0);
    await run(w.sql, true);
    const again = await run(w.sql, true);
    expect(again).toMatchObject({
      company: false,
      doc: false,
      policyDoc: false,
      partners: 0,
      grants: 0,
    });
    const [c] = await w.sql<
      { company_name: string }[]
    >`select company_name from contracts.company_settings where tenant_id = ${w.A}`;
    expect(c?.company_name).toBe("Công ty Demo");
    const [d] = await w.sql<
      { n: number; t: number }[]
    >`select count(*)::int as n, (select count(*)::int from knowledge.chunks where tenant_id = ${w.A}) as t
      from knowledge.documents where tenant_id = ${w.A}`;
    // ai-tiers-rag: tài liệu demo (3 đoạn) + quy chế QC-TC-01 (3 đoạn) = 2 tài liệu, 6 đoạn.
    expect(d).toEqual({ n: 2, t: 6 });
    const [b] = await w.sql<
      { n: number }[]
    >`select count(*)::int as n from knowledge.documents where tenant_id = ${w.B}`;
    expect(b?.n).toBe(0);
  });
  it("friendly-groups · demo: phòng ban tên thật, người dùng tên Việt (username giữ), không còn Beta testers; tenant khác không đụng", async () => {
    await run(w.sql, true);
    const g = await w.sql<
      { key: string; vi: string }[]
    >`select key, name ->> 'vi' as vi from admin.groups
      where tenant_id = ${w.A} and key in ('pb-giam-doc', 'pb-kho-van', 'beta-testers') order by key`;
    expect(g.map((x) => `${x.key}=${x.vi}`)).toEqual([
      "pb-giam-doc=Ban Giám đốc",
      "pb-kho-van=Kho vận",
    ]);
    const [u] = await w.sql<
      { display_name: string; username: string; n: number }[]
    >`select u.display_name, u.username,
      (select count(*)::int from admin.group_members m join admin.groups g on g.id = m.group_id and g.key = 'pb-giam-doc' where m.user_id = u.id) as n
      from admin.users u where u.id = ${w.boss}`;
    expect(u?.display_name).toBe("Nguyễn Văn An – Giám đốc");
    expect(u?.n).toBe(1);
    expect(u?.username).not.toContain("Nguyễn");
  });
});
