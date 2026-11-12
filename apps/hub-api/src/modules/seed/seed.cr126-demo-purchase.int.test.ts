// CR-126 · cr126-demo-purchase-seed · D7: công ty `demo` sau `writeCr125Config` chạy được trọn «Quy trình mua hàng» mà không set tay:
// mẫu cha (không gán cho công ty — CR-127 Z9), ba phần có trong Thư viện, mọi nhóm duyệt có người, mọi dòng «cùng duyệt» có ≥ 2 người KHÁC NHAU, chạy lại 0 đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { PURCHASE_PARENT_ID, PURCHASE_PHASE_KEYS } from "../processes/public";
import { PURCHASE_ROLE_GROUPS, writeCr125Config } from "./seed.cr125-config";

const T = "00000000-0000-4000-8000-000000012603";
let o: Sql;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, active) values (${T}, 'demo', 'Demo', true)`;
  await o`insert into admin.users ${o(
    ["demo-owner", "demo-editor", "demo-viewer"].map((username) => ({
      id: crypto.randomUUID(),
      tenant_id: T,
      username,
      email: `${username}@demo.local`,
      password_hash: "x",
      display_name: username,
      role: username === "demo-owner" ? "tenant_admin" : "member",
      locale: "en",
      must_change_password: false,
    })),
  )}`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
    select f.id, ${T}, null from admin.features f where f.key = 'contracts-read' on conflict do nothing`;
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-126 · demo chạy trọn «Quy trình mua hàng» ngay sau seed", () => {
  it("cha không gán, mọi nhóm có người, dòng cùng duyệt ≥ 2 người khác nhau, chạy lại 0 đổi", async () => {
    const r1 = await o.begin((tx) => writeCr125Config(tx as never, ["demo"]));
    expect(r1.groupMembers).toBeGreaterThan(0);

    // CR-127 Z9: seed KHÔNG gán «Quy trình mua hàng» cho công ty (quản trị nền tảng tạo quy trình riêng từ sơ đồ trống); mẫu còn trong Thư viện.
    const cf =
      await o`select 1 from hub.company_flows where tenant_id = ${T} and flow_id = ${PURCHASE_PARENT_ID}`;
    expect(cf.length).toBe(0);
    const phases = await o`select key from hub.process_defs
      where tenant_id is null and key = any(${[...PURCHASE_PHASE_KEYS]}::text[]) and published_version is not null and deleted_at is null`;
    expect(phases.length).toBe(PURCHASE_PHASE_KEYS.length);

    // mỗi nhóm duyệt của «mua hàng» có ≥ 1 thành viên
    const all = [...new Set(Object.values(PURCHASE_ROLE_GROUPS).flat())];
    const per = await o`select g.key, count(m.user_id)::int as n from admin.groups g
      left join admin.group_members m on m.group_id = g.id
      where g.tenant_id = ${T} and g.key = any(${all}::text[]) group by g.key`;
    expect(per.length).toBe(all.length);
    for (const p of per) expect([p.key, (p.n as number) >= 1]).toEqual([p.key, true]);

    // mọi bước «cùng duyệt» của 3 phần: số người khác nhau qua các nhóm ≥ 2
    const rows = await o`select d.key as def, s->>'name' as stage,
        (select count(distinct m.user_id)::int from jsonb_array_elements(s->'after'->'parallel'->'groups') pg
          join admin.groups g on g.tenant_id = ${T} and g.key = pg->>'group_key'
          join admin.group_members m on m.group_id = g.id) as people
      from hub.process_defs d
      join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
      cross join jsonb_array_elements(r.stages) s
      where d.tenant_id is null and d.key = any(${[...PURCHASE_PHASE_KEYS]}::text[])
        and s->'after'->'parallel' is not null`;
    expect(rows.length).toBe(3);
    for (const x of rows) expect([x.stage, (x.people as number) >= 2]).toEqual([x.stage, true]);

    const r2 = await o.begin((tx) => writeCr125Config(tx as never, ["demo"]));
    expect({ ...r2 }).toEqual({
      features: 0,
      esign: 0,
      groups: 0,
      groupMembers: 0,
      libraryDefs: 0,
      libraryReleases: 0,
      flowFlags: 0,
      esignSigners: 0,
      partnerSigners: 0,
    });
  });
});
