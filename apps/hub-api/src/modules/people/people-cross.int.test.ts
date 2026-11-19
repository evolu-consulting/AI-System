// CR-191 · lát cr191-cross-person-card · BR-191-13 · int (DB thật): thẻ người CHÉO công ty `hub.cc_person_cards` qua `GET /people?ids=` (`PeopleService.cards`).
// Công ty ĐÃ KẾT NỐI ⇒ ảnh/tên/chức vụ/tên công ty; chưa kết nối / một chiều / bị chặn / ngắt ⇒ bỏ qua (không lỗi); người ngoài (external) của công ty kết nối ⇒ bỏ;
// người gọi là người dùng ngoài ⇒ không có thẻ chéo; KHÔNG email/điện thoại/cột khác. N2 · người xem KHÔNG phải người sở hữu ảnh. Perf: MỘT câu cho cả lô 50.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, type HubScopeArg, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { AuthUser } from "../../lib/auth.middleware";
import { cardsOf } from "./people.repo";
import { PeopleService } from "./people.service";

const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(8)}BBBB`;
const T = {
  a: tenantId(1921),
  b: tenantId(1922),
  c: tenantId(1923),
  d: tenantId(1924),
  e: tenantId(1925),
};
const U = {
  a1: userId(1921),
  a2: userId(1922),
  b1: userId(1923),
  b2: userId(1924),
  bx: userId(1925),
  c1: userId(1926),
  d1: userId(1927),
  e1: userId(1928),
  ax: userId(1929),
};
const UNKNOWN = "00000000-0000-4000-8000-0000000019ff";
let o: Sql;
let db: Db;
let svc: PeopleService;
const au = (k: keyof typeof U, t: string, kind: "internal" | "external" = "internal"): AuthUser =>
  ({ userId: U[k], tenantId: t, role: "member", userKind: kind }) as unknown as AuthUser;
const link = (f: string, t: string) =>
  o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at) values (${f}, ${t}, now()) on conflict do nothing`;
const ids = async (u: AuthUser, want: string[]) =>
  (await svc.cards(u, want)).items.map((x) => x.user_id).sort();

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name) values
    (${T.a}, 'xc1921', 'Công ty A', null), (${T.b}, 'xc1922', 'B ngắn', 'Công ty B đầy đủ'), (${T.c}, 'xc1923', 'Công ty C', null),
    (${T.d}, 'xc1924', 'Công ty D', null), (${T.e}, 'xc1925', 'Công ty E', null) on conflict do nothing`;
  await users(o, T.a, 2, { from: 1921 });
  await users(o, T.b, 2, { from: 1923 });
  await users(o, T.c, 1, { from: 1926 });
  await users(o, T.d, 1, { from: 1927 });
  await users(o, T.e, 1, { from: 1928 });
  const orgB = "00000000-0000-4000-8000-0000000019a1";
  const orgA = "00000000-0000-4000-8000-0000000019a2";
  await o`insert into admin.external_orgs (id, tenant_id, name) values (${orgB}, ${T.b}, 'NCC của B'), (${orgA}, ${T.a}, 'NCC của A') on conflict do nothing`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id, must_change_password, email) values
    (${U.bx}, ${T.b}, 'bx', 'x', 'Đối tác cộng đồng của B', 'member', 'external', ${orgB}, false, 'bx@ncc.vn'),
    (${U.ax}, ${T.a}, 'ax', 'x', 'Đối tác cộng đồng của A', 'member', 'external', ${orgA}, false, null)`;
  await o`update admin.users set email = 'b1@b.vn' where id = ${U.b1}`;
  await o`insert into hub.people_profiles (tenant_id, user_id, job_title, avatar) values
    (${T.b}, ${U.b1}, 'Trưởng phòng mua hàng', ${PNG}), (${T.c}, ${U.c1}, 'Giám đốc C', ${PNG}), (${T.d}, ${U.d1}, 'Kế toán D', ${PNG}),
    (${T.e}, ${U.e1}, 'Kế toán E', ${PNG}), (${T.a}, ${U.a2}, 'Chuyên viên A', ${PNG}), (${T.b}, ${U.bx}, 'Ngoài B', ${PNG})
    on conflict (tenant_id, user_id) do update set job_title = excluded.job_title, avatar = excluded.avatar`;
  await link(T.a, T.b);
  await link(T.b, T.a);
  await link(T.a, T.d);
  await link(T.d, T.a);
  await link(T.a, T.e); // E: chỉ MỘT chiều
  db = createDb(urls().hubApi, { max: 2 });
  svc = new PeopleService(db);
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-191 · thẻ người chéo công ty", () => {
  it("người công ty ĐÃ KẾT NỐI ⇒ có ảnh, họ tên, chức vụ, tên công ty (ưu tiên tên pháp lý), N2 · người xem không phải chủ ảnh", async () => {
    const r = await svc.cards(au("a2", T.a), [U.b1, U.b2]);
    const by = new Map(r.items.map((x) => [x.user_id, x]));
    expect(by.get(U.b1)).toMatchObject({
      avatar: PNG,
      job_title: "Trưởng phòng mua hàng",
      company_name: "Công ty B đầy đủ",
      department: null,
    });
    expect(by.get(U.b1)?.display_name).toBeTruthy();
    expect(by.get(U.b2)).toMatchObject({
      avatar: null,
      job_title: null,
      company_name: "Công ty B đầy đủ",
    });
    expect((await svc.cards(au("b2", T.b), [U.a2])).items[0]).toMatchObject({
      avatar: PNG,
      company_name: "Công ty A",
    });
  });

  it("công ty chưa kết nối / một chiều / người dùng ngoài của công ty kết nối / id lạ ⇒ bỏ qua, không lỗi, không lộ", async () => {
    expect(await ids(au("a1", T.a), [U.b1, U.c1, U.e1, U.bx, UNKNOWN])).toEqual([U.b1]);
    expect(await ids(au("a1", T.a), [U.c1, U.e1, U.bx, UNKNOWN])).toEqual([]);
  });

  it("người cùng công ty vẫn theo luật cũ (không có company_name), người ngoài của chính mình vẫn thấy", async () => {
    const r = await svc.cards(au("a1", T.a), [U.a2, U.ax, U.b1]);
    const by = new Map(r.items.map((x) => [x.user_id, x]));
    expect(by.size).toBe(3);
    expect(by.get(U.a2)).toMatchObject({ job_title: "Chuyên viên A", avatar: PNG });
    expect(by.get(U.a2)).not.toHaveProperty("company_name");
    expect(by.get(U.ax)).not.toHaveProperty("company_name");
    expect(by.get(U.b1)).toHaveProperty("company_name");
  });

  it("ngắt kết nối hoặc bị chặn ⇒ mất ngay, nối lại ⇒ hiện lại (không cache)", async () => {
    expect(await ids(au("a1", T.a), [U.d1])).toEqual([U.d1]);
    await o`update hub.partner_links set accepted_at = null where from_tenant = ${T.d} and to_tenant = ${T.a}`;
    expect(await ids(au("a1", T.a), [U.d1])).toEqual([]);
    await o`update hub.partner_links set accepted_at = now(), blocked_at = now() where from_tenant = ${T.d} and to_tenant = ${T.a}`;
    expect(await ids(au("a1", T.a), [U.d1])).toEqual([]);
    await o`update hub.partner_links set blocked_at = null where from_tenant = ${T.d} and to_tenant = ${T.a}`;
    expect(await ids(au("a1", T.a), [U.d1])).toEqual([U.d1]);
  });

  it("người gọi là người dùng ngoài (token hoặc DB) ⇒ không có thẻ chéo công ty", async () => {
    expect(await ids(au("ax", T.a, "external"), [U.b1, U.d1])).toEqual([]);
    expect(await ids(au("ax", T.a, "internal"), [U.b1, U.d1])).toEqual([]);
    const fn = (s: HubScopeArg) =>
      inHub(s, (tx) => tx`select * from hub.cc_person_cards(array[${U.b1}]::uuid[])`);
    expect(await fn({ kind: "user", tenantId: T.a, userId: U.ax })).toHaveLength(0);
    await expect(fn({ kind: "system" })).rejects.toMatchObject({ code: "42501" });
  });

  it("chỉ trả họ tên, chức vụ, ảnh, tên công ty — KHÔNG email/điện thoại/cột khác", async () => {
    const rows = await inHub(
      { kind: "user", tenantId: T.a, userId: U.a1 },
      (tx) => tx`select * from hub.cc_person_cards(array[${U.b1}, ${U.bx}]::uuid[])`,
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      ["avatar", "company_name", "display_name", "job_title", "user_id"].sort(),
    );
    const item = (await svc.cards(au("a1", T.a), [U.b1])).items[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ["avatar", "company_name", "department", "display_name", "job_title", "user_id"].sort(),
    );
    expect(JSON.stringify(item)).not.toContain("@");
  });

  it("perf · MỘT câu SQL cho cả lô 50 id, p95 in số thật", async () => {
    const fake = Array.from(
      { length: 43 },
      (_, i) => `00000000-0000-4000-8000-${(0x19b000 + i).toString(16).padStart(12, "0")}`,
    );
    const batch = [U.a2, U.b1, U.b2, U.c1, U.d1, U.e1, U.bx, ...fake];
    let n = 0;
    const counting = (tx: Tx): Tx =>
      new Proxy(tx, {
        get(t, k, r) {
          const v = Reflect.get(t, k, r);
          if (k !== "execute") return v;
          return (...a: unknown[]) => {
            n++;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        },
      });
    const sc = { kind: "user", tenantId: T.a, userId: U.a1 } as const;
    const lat: number[] = [];
    for (let i = 0; i < 30; i++) {
      n = 0;
      const t0 = performance.now();
      const r = await withHubScope(db, sc, (tx) => cardsOf(counting(tx), T.a, U.a1, false, batch));
      lat.push(performance.now() - t0);
      expect(n).toBe(1);
      expect(r.length).toBe(4); // a2 + b1 + b2 + d1 (c/e/bx/id lạ bị bỏ)
    }
    lat.sort((x, y) => x - y);
    const p95 = lat[Math.floor(lat.length * 0.95) - 1] ?? 0;
    console.log(`[cr191-cross-person-card] lô 50 id: 1 câu SQL, p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(150);
  });
});
