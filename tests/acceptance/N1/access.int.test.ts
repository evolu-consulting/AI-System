// PK-FR-05 · PK-AC05 · PK-AC06 · PK-FR-09 (JWT) · D-05/Q8/Q9 · plan §5: kiểm quyền gói ở hub-api từ ConfigCache (không HTTP),
// `GET /pack/<k>/me`, PACK_DISABLED / PACK_FORBIDDEN, hiệu lực ≤ 5 s qua `config_changed`. Bật gói bằng route admin-api THẬT.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  afterReload,
  bumpConfig,
  type CtxN1,
  ID,
  itemBody,
  needPackKit,
  P,
  PK,
  packsPath,
  seedItem,
  startN1,
  T,
  untilHubSettles,
} from "./_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
});
afterAll(async () => {
  await c?.stop();
});
const err = (r: { status: number; json?: { error?: { code?: string } } }) => ({
  status: r.status,
  code: r.json?.error?.code,
});
const me = (p: (typeof P)[keyof typeof P]) => c.hubCall(p, "GET", `/pack/${PK}/me`);
const actions = async (p: (typeof P)[keyof typeof P]): Promise<string[]> =>
  (await me(p)).json?.actions ?? [];
/** Dựng acme: bật gói; lan=owner · hoa=editor · tam=viewer; cuc không Group. */
async function arrange(): Promise<void> {
  await needPackKit(c.sql);
  await c.sql`truncate pkdemo.item_lines, pkdemo.items`;
  await c.enable(T.acme);
  await c.addToRole(T.acme, "owner", [P.lan]);
  await c.addToRole(T.acme, "editor", [P.hoa]);
  await c.addToRole(T.acme, "viewer", [P.tam]);
  await seedItem(c.sql, T.acme, ID.itemA, ID.lineA);
}

describe("PK-AC06 · gói chưa bật ⇒ PACK_DISABLED", () => {
  it("PK-AC06 · tenant chưa có entitlement: mọi API gói (đọc + ghi) ⇒ 403 PACK_DISABLED", async () => {
    await needPackKit(c.sql);
    await c.sql`update admin.feature_entitlements set revoked_at = now() where tenant_id = ${T.acme}`;
    await bumpConfig(c.sql, T.acme);
    const read = await c.hubCall(P.lan, "GET", `/pack/${PK}/items/${ID.itemA}`);
    const write = await c.hubCall(P.lan, "POST", `/pack/${PK}/items`, itemBody("x", 1));
    expect([err(read), err(write)]).toEqual([
      { status: 403, code: "PACK_DISABLED" },
      { status: 403, code: "PACK_DISABLED" },
    ]);
  });
  it("PK-AC06 · /me khi chưa bật ⇒ 200 {pack, enabled:false, actions:[]} (không 403)", async () => {
    await needPackKit(c.sql);
    const r = await me(P.lan);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ pack: PK, enabled: false, actions: [] });
  });
  it("PK-AC06 · tenant này bật, tenant khác chưa: an (beta) ⇒ PACK_DISABLED trong khi lan (acme) dùng được", async () => {
    await arrange();
    const beta = await c.hubCall(P.an, "GET", `/pack/${PK}/items/${ID.itemA}`);
    const acme = await c.hubCall(P.lan, "GET", `/pack/${PK}/items/${ID.itemA}`);
    expect([err(beta), acme.status]).toEqual([{ status: 403, code: "PACK_DISABLED" }, 200]);
  });
  it("PK-AC06 · feature status='off' ⇒ PACK_DISABLED dù đã có entitlement và Group", async () => {
    await arrange();
    await c.sql`update admin.features set status = 'off' where key = 'pkdemo-read'`;
    await bumpConfig(c.sql, T.acme);
    const r = await untilHubSettles(
      c.hub,
      () => c.hubCall(P.lan, "GET", `/pack/${PK}/items/${ID.itemA}`),
      (x) => x.status === 403,
    );
    await c.sql`update admin.features set status = 'on' where key = 'pkdemo-read'`;
    await bumpConfig(c.sql, T.acme);
    expect(err(r)).toEqual({ status: 403, code: "PACK_DISABLED" });
  });
  it("PK-AC06 · DELETE …/packs/pkdemo (admin) ⇒ Hub thấy PACK_DISABLED ≤ 5 s", async () => {
    await arrange();
    expect((await c.admin.call("DELETE", packsPath(T.acme, PK))).status).toBe(204);
    const r = await untilHubSettles(
      c.hub,
      () => me(P.lan),
      (x) => x.json?.enabled === false,
    );
    expect(r.json).toEqual({ pack: PK, enabled: false, actions: [] });
  });
});

describe("PK-AC05 · PACK_FORBIDDEN theo vai", () => {
  it("PK-AC05 · /me: viewer=[read] · editor=[read,write] · owner=[read,write,admin] · cuc (không Group)=[] enabled=true", async () => {
    await arrange();
    const r = await Promise.all([actions(P.tam), actions(P.hoa), actions(P.lan), me(P.cuc)]);
    expect(r.slice(0, 3)).toEqual([["read"], ["read", "write"], ["read", "write", "admin"]]);
    expect(r[3].status).toBe(200);
    expect(r[3].json).toEqual({ pack: PK, enabled: true, actions: [] });
  });
  it("PK-AC05 · viewer gọi API ghi ⇒ 403 PACK_FORBIDDEN; viewer đọc ⇒ 200", async () => {
    await arrange();
    const w = await c.hubCall(P.tam, "POST", `/pack/${PK}/items`, itemBody("viewer ghi", 1));
    const r = await c.hubCall(P.tam, "GET", `/pack/${PK}/items/${ID.itemA}`);
    expect([err(w), r.status]).toEqual([{ status: 403, code: "PACK_FORBIDDEN" }, 200]);
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from pkdemo.items where title = 'viewer ghi'`;
    expect(n?.n).toBe(0); // bị chặn trước khi chạm DB ghi
  });
  it("PK-AC05 · editor ghi được ⇒ 201; owner ghi được ⇒ 201", async () => {
    await arrange();
    const e = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("editor ghi", 2));
    const o = await c.hubCall(P.lan, "POST", `/pack/${PK}/items`, itemBody("owner ghi", 1));
    expect([e.status, o.status]).toEqual([201, 201]);
  });
  it("PK-AC05 · user đã bật gói nhưng không thuộc Group nào (cuc) ⇒ đọc/ghi 403 PACK_FORBIDDEN", async () => {
    await arrange();
    const r = await c.hubCall(P.cuc, "GET", `/pack/${PK}/items/${ID.itemA}`);
    const w = await c.hubCall(P.cuc, "POST", `/pack/${PK}/items`, itemBody("x", 1));
    expect([err(r), err(w)]).toEqual([
      { status: 403, code: "PACK_FORBIDDEN" },
      { status: 403, code: "PACK_FORBIDDEN" },
    ]);
  });
  it("PK-AC05 · thêm viewer vào editor ⇒ được ghi ≤ 5 s (config_changed), không cần đăng nhập lại", async () => {
    await arrange();
    expect(await actions(P.tam)).toEqual(["read"]);
    await c.addToRole(T.acme, "editor", [P.tam]);
    const a = await untilHubSettles(
      c.hub,
      () => actions(P.tam),
      (x) => x.includes("write"),
      5_000,
    );
    expect(a).toEqual(["read", "write"]);
    const w = await c.hubCall(P.tam, "POST", `/pack/${PK}/items`, itemBody("sau khi thêm", 1));
    expect(w.status).toBe(201);
  });
  it("PK-AC05 · gỡ khỏi Group ⇒ mất quyền ghi ≤ 5 s", async () => {
    await arrange();
    await c.sql`delete from admin.group_members where user_id = ${P.hoa.id}
      and group_id = (select id from admin.groups where tenant_id = ${T.acme} and key = 'pkdemo-editor')`;
    await bumpConfig(c.sql, T.acme);
    const a = await untilHubSettles(
      c.hub,
      () => actions(P.hoa),
      (x) => x.length === 0,
      5_000,
    );
    expect(a).toEqual([]);
  });
  it("PK-FR-05 · user inactive / khoá bởi tenant, dù thuộc Group ⇒ không quyền (không 200/201)", async () => {
    await arrange();
    await c.addToRole(T.acme, "editor", [P.nghi, P.khoa]);
    const inactive = await c.hubCall(P.nghi, "POST", `/pack/${PK}/items`, itemBody("x", 1));
    const locked = await c.hubCall(P.khoa, "POST", `/pack/${PK}/items`, itemBody("x", 1));
    expect([inactive.status, locked.status].every((s) => s === 401 || s === 403)).toBe(true);
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from pkdemo.items where title = 'x'`;
    expect(n?.n).toBe(0);
  });
  it("PK-FR-05 · Q9: grant USER LẺ cho mã gói bị hub-api bỏ qua (chỉ Group có hiệu lực)", async () => {
    await arrange();
    const [f] = await c.sql<
      { id: string }[]
    >`select id from admin.features where key = 'pkdemo-write'`;
    await c.sql`insert into admin.feature_grants (tenant_id, feature_id, user_id) values (${T.acme}, ${f?.id as string}, ${P.cuc.id})`;
    await afterReload(c.hub, () => bumpConfig(c.sql, T.acme)); // Hub bắt đầu nạp lại cấu hình
    const a = await untilHubSettles(
      c.hub,
      () => actions(P.cuc),
      (x) => x.length === 0,
      5_000,
    );
    expect(a).toEqual([]); // đo SAU nạp lại: grant user lẻ không tạo quyền
    const w = await c.hubCall(P.cuc, "POST", `/pack/${PK}/items`, itemBody("x", 1));
    expect(err(w)).toEqual({ status: 403, code: "PACK_FORBIDDEN" });
  });
  it("PK-FR-05 · quyền theo tenant: Group pkdemo của beta không cấp quyền ở acme (an beta thành viên viewer beta ≠ acme)", async () => {
    await arrange();
    await c.enable(T.beta);
    await c.addToRole(T.beta, "owner", [P.an]);
    const beta = await actions(P.an);
    const acmeItem = await c.hubCall(P.an, "GET", `/pack/${PK}/items/${ID.itemA}`);
    expect(beta).toEqual(["read", "write", "admin"]);
    expect(acmeItem.status).toBe(404); // hàng của acme: RLS ⇒ NOT_FOUND, không lộ tồn tại
  });
});

describe("PK-FR-09 · JWT hub-api cho API gói", () => {
  it("PK-FR-09 · không token / token hỏng ⇒ 401; token đúng ⇒ qua", async () => {
    await arrange();
    const no = await fetch(`${c.hub.base}/pack/${PK}/me`);
    const bad = await fetch(`${c.hub.base}/pack/${PK}/me`, {
      headers: { authorization: "Bearer x.y.z" },
    });
    expect([no.status, bad.status, (await me(P.lan)).status]).toEqual([401, 401, 200]);
  });
});
