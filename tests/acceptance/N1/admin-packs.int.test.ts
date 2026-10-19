// PK-FR-05 · PK-AC05 (nửa Admin) · D-05 · plan §2 "Route admin-api" + §5 "Bật gói": GET/PUT/DELETE
// `/tenants/:tenant_id/packs[/:pack_key]` (chỉ platform admin) — bật gói = entitlement 3 feature + 3 Group + 6 grant, một tx,
// audit (enum M4 sẵn có: grant/revoke + entity entitlement + summary.op 'pack.enable'|'pack.disable'; chỉ khi có đổi), `config_changed` NOTIFY. Đường dẫn: xem `ADMIN_PACKS_BASE` (Tranh chấp test trong tasks.md).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  type CtxN1,
  needPackKit,
  OWNER_URL,
  P,
  PK,
  packFeatureKey,
  packGroupKey,
  packsPath,
  startN1,
  T,
} from "./_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
});
afterAll(async () => {
  await c?.stop();
});
const grantsOf = async (tid: string) =>
  (
    await c.sql<{ grp: string; feat: string }[]>`select g.key as grp, f.key as feat
      from admin.feature_grants fg join admin.groups g on g.id = fg.group_id
      join admin.features f on f.id = fg.feature_id
      where fg.tenant_id = ${tid} and f.key like ${`${PK}-%`} order by 1, 2`
  ).map((r) => `${r.grp}>${r.feat}`);
const groupsOf = async (tid: string) =>
  (
    await c.sql<
      { key: string }[]
    >`select key from admin.groups where tenant_id = ${tid} and key like ${`${PK}-%`} order by 1`
  ).map((r) => r.key);
const entOf = async (tid: string) =>
  c.sql<{ key: string; revoked: boolean }[]>`select f.key, e.revoked_at is not null as revoked
    from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
    where e.tenant_id = ${tid} and f.key like ${`${PK}-%`} order by 1`;

const GRANTS = [
  "pkdemo-editor>pkdemo-read",
  "pkdemo-editor>pkdemo-write",
  "pkdemo-owner>pkdemo-admin",
  "pkdemo-owner>pkdemo-read",
  "pkdemo-owner>pkdemo-write",
  "pkdemo-viewer>pkdemo-read",
];

describe("PK-AC05 · bật gói (PUT) tạo 3 Group + 6 grant", () => {
  it("PK-FR-05 · catalog: 3 feature pkdemo-read|write|admin do packs.install ghi sẵn (status on)", async () => {
    await needPackKit(c.sql);
    const f = await c.sql<
      { key: string; status: string }[]
    >`select key, status from admin.features where key like 'pkdemo-%' order by key`;
    expect([...f]).toEqual([
      { key: "pkdemo-admin", status: "on" },
      { key: "pkdemo-read", status: "on" },
      { key: "pkdemo-write", status: "on" },
    ]);
  });
  it("PK-AC05 · PUT /tenants/:id/packs/pkdemo ⇒ 200 PackState {key, enabled:true, groups: owner/editor/viewer uuid}", async () => {
    await needPackKit(c.sql);
    const r = await c.admin.call("PUT", packsPath(T.acme, PK));
    expect(r.status).toBe(200);
    expect(r.json.key).toBe(PK);
    expect(r.json.enabled).toBe(true);
    const groups = r.json.groups as { role: string; group_id: string }[];
    expect(groups.map((g) => g.role).sort()).toEqual(["editor", "owner", "viewer"]);
    const ids = new Set(groups.map((g) => g.group_id));
    expect(ids.size).toBe(3);
    const dbIds = await c.sql<
      { id: string; key: string }[]
    >`select id, key from admin.groups where tenant_id = ${T.acme} and key like 'pkdemo-%'`;
    expect(new Set(dbIds.map((g) => g.id))).toEqual(ids);
  });
  it("PK-AC05 · DB: 3 Group <k>-owner|editor|viewer của tenant · 6 grant (viewer=read; editor=read+write; owner=cả ba) · 3 entitlement còn hiệu lực", async () => {
    await needPackKit(c.sql);
    await c.enable(T.acme);
    expect(await groupsOf(T.acme)).toEqual([
      packGroupKey(PK, "editor"),
      packGroupKey(PK, "owner"),
      packGroupKey(PK, "viewer"),
    ]);
    expect(await grantsOf(T.acme)).toEqual(GRANTS);
    expect([...(await entOf(T.acme))]).toEqual(
      ["admin", "read", "write"].map((a) => ({ key: packFeatureKey(PK, a), revoked: false })),
    );
    expect(await groupsOf(T.beta)).toEqual([]); // tenant khác không bị đụng
  });
  it("PK-AC05 · PUT idempotent: lần 2 ⇒ 200, cùng group_id, vẫn 3 Group / 6 grant (không nhân đôi)", async () => {
    await needPackKit(c.sql);
    const a = await c.enable(T.acme);
    const b = await c.enable(T.acme);
    const key = (s: { groups: { role: string; group_id: string }[] }) =>
      s.groups.map((g) => `${g.role}:${g.group_id}`).sort();
    expect(key(b)).toEqual(key(a));
    expect((await groupsOf(T.acme)).length).toBe(3);
    expect((await grantsOf(T.acme)).length).toBe(6);
  });
  it("PK-FR-05 · audit: PUT bật (có đổi) ghi đúng 1 hàng audit_log {action grant, entity entitlement, summary.op 'pack.enable', tenant đúng}; PUT lặp idempotent không ghi thêm", async () => {
    await needPackKit(c.sql);
    await c.sql`update admin.feature_entitlements set revoked_at = now()
      where tenant_id = ${T.acme} and feature_id in (select id from admin.features where key like ${`${PK}-%`})`;
    const count = async (op: string) =>
      (
        await c.sql<{ n: number }[]>`select count(*)::int as n from admin.audit_log
          where action in ('grant', 'revoke') and entity = 'entitlement'
            and summary->>'op' = ${op} and tenant_id = ${T.acme}`
      )[0]?.n ?? 0;
    const before = await count("pack.enable");
    await c.enable(T.acme);
    const after = await count("pack.enable");
    expect(after - before).toBe(1);
    await c.enable(T.acme); // lặp: không đổi gì ⇒ không audit mới (bất biến M4 sự kiện ⇔ audit)
    expect(await count("pack.enable")).toBe(after);
  });
  it("PK-FR-05 · PUT tăng config_version và phát NOTIFY config_changed (Hub nạp lại ≤ 5 s)", async () => {
    await needPackKit(c.sql);
    const lis = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
    try {
      const got: string[] = [];
      let wake: () => void = () => {};
      const first = new Promise<void>((r) => {
        wake = r;
      });
      await lis.listen("config_changed", (raw) => {
        got.push(raw);
        wake();
      });
      const v0 =
        (await c.sql<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ??
        0;
      const r = await c.admin.call("PUT", packsPath(T.beta, PK));
      expect(r.status).toBe(200);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const guard = new Promise<void>((res) => {
        timer = setTimeout(res, 5_000); // lưới an toàn
      });
      await Promise.race([first, guard]);
      clearTimeout(timer);
      const v1 =
        (await c.sql<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ??
        0;
      expect(v1).toBeGreaterThan(v0);
      expect(got.length).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(got[got.length - 1] as string).v).toBe(v1);
    } finally {
      await lis.end({ timeout: 1 });
    }
  });
});

describe("PK-FR-05 · GET danh sách và DELETE (tắt gói)", () => {
  it("PK-FR-05 · GET /tenants/:id/packs ⇒ 200 {items:[{key:'pkdemo', enabled, groups}]}: acme bật, beta chưa", async () => {
    await needPackKit(c.sql);
    await c.enable(T.acme);
    await c.sql`update admin.feature_entitlements set revoked_at = now() where tenant_id = ${T.beta}`;
    const a = await c.admin.call("GET", packsPath(T.acme));
    const b = await c.admin.call("GET", packsPath(T.beta));
    expect(a.status).toBe(200);
    expect(a.json.items.find((x: { key: string }) => x.key === PK)?.enabled).toBe(true);
    expect(b.status).toBe(200);
    expect(b.json.items.find((x: { key: string }) => x.key === PK)?.enabled).toBe(false);
  });
  it("PK-FR-05 · DELETE ⇒ 204: thu hồi 3 entitlement (revoked_at), GIỮ Group + grant; GET ⇒ enabled=false; PUT lại ⇒ bật lại", async () => {
    await needPackKit(c.sql);
    await c.enable(T.acme);
    const d = await c.admin.call("DELETE", packsPath(T.acme, PK));
    expect(d.status).toBe(204);
    expect((await entOf(T.acme)).map((e) => e.revoked)).toEqual([true, true, true]);
    expect(await groupsOf(T.acme)).toHaveLength(3);
    expect(await grantsOf(T.acme)).toEqual(GRANTS);
    const g = await c.admin.call("GET", packsPath(T.acme));
    expect(g.json.items.find((x: { key: string }) => x.key === PK)?.enabled).toBe(false);
    const a = (
      await c.sql<{ n: number }[]>`select count(*)::int as n from admin.audit_log
        where action = 'revoke' and entity = 'entitlement'
          and summary->>'op' = 'pack.disable' and tenant_id = ${T.acme}`
    )[0]?.n;
    expect(a).toBeGreaterThanOrEqual(1);
    await c.enable(T.acme);
    expect((await entOf(T.acme)).map((e) => e.revoked)).toEqual([false, false, false]);
  });
});

describe("PK-FR-05 · lỗi và phân quyền route admin", () => {
  it("PK-FR-05 · khoá gói chưa cài (hợp lệ về dạng) ⇒ 404 PACK_NOT_FOUND", async () => {
    await needPackKit(c.sql);
    const r = await c.admin.call("PUT", packsPath(T.acme, "chuacai"));
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 404,
      code: "PACK_NOT_FOUND",
    });
  });
  it("PK-FR-01 · khoá sai dạng / bị cấm (Bad-Key, public, pg_x) ⇒ 400 VALIDATION_ERROR, không đụng DB", async () => {
    await needPackKit(c.sql);
    const codes: Record<string, number> = {};
    for (const k of ["Bad-Key", "public", "pg_x"])
      codes[k] = (await c.admin.call("PUT", packsPath(T.acme, k))).status;
    expect(codes).toEqual({ "Bad-Key": 400, public: 400, pg_x: 400 });
  });
  it("PK-FR-05 · chỉ platform admin: tenant_admin và member ⇒ 403; không token ⇒ 401", async () => {
    await needPackKit(c.sql);
    const asAdmin = await c.admin.call(
      "PUT",
      packsPath(T.acme, PK),
      undefined,
      await c.tok(P.tadmin),
    );
    const asMember = await c.admin.call(
      "PUT",
      packsPath(T.acme, PK),
      undefined,
      await c.tok(P.lan),
    );
    const noTok = await c.admin.call("PUT", packsPath(T.acme, PK), undefined, "x.y.z");
    expect([asAdmin.status, asMember.status, noTok.status]).toEqual([403, 403, 401]);
  });
  it("PK-FR-05 · tenant không tồn tại ⇒ 404", async () => {
    await needPackKit(c.sql);
    const r = await c.admin.call("PUT", packsPath("a1000000-0000-4000-8000-0000000fffff", PK));
    expect(r.status).toBe(404);
  });
});
