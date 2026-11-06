// CR-121 c19 (D2) · int (DB test, role hub_api, scope system): check `app_roles` chạy một lượt ops-watch THẬT, MỘT file cho 5 quy tắc.
// Mỗi quy tắc: tạo đúng một dữ liệu lệch (công ty/vai/người dùng riêng của test) ⇒ số đếm quy tắc tăng đúng 1 và mẫu nêu tên công ty;
// sửa ⇒ số đếm về mức nền (DB clone có thể có sẵn dữ liệu nên so với nền, không so với 0). Quy tắc 2 = warn (không làm check đỏ một mình).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { appRolesCheck } from "./adapters/checks/app-roles.check";
import { runChecksOnce } from "./application/ops.round";
import { opsRoundDeps } from "./ops.mount";

const T1 = tenantId(1301); // R1: tenant_admin không có mức Quản trị ở app đang bật
const T2 = tenantId(1302); // R2: member có grant vượt trần (trần = read)
const T3 = tenantId(1303); // R3: mã vai app trùng vai hub
const T4 = tenantId(1304); // R4: thành viên vai app thuộc công ty khác
const T5 = tenantId(1305); // R5: vai app của app không bật (cũng là công ty "khác" của R4)
const U1 = userId(1301);
const U2 = userId(1302);
const U4 = userId(1304);

let o: Sql;
let db: Db;
const NOW = new Date("2026-11-06T08:00:00Z");
const deps = () =>
  opsRoundDeps({ db, ops: { checks: [appRolesCheck], timeoutMs: 5_000 }, log: console as never });
type Row = { status: string; message: string; value: Record<string, number> };
let minute = 0;
const round = async (): Promise<Row> => {
  await o`update hub.ops_settings set last_round_at = null where id = 1`;
  await runChecksOnce(deps(), new Date(NOW.getTime() + 31 * 60_000 * minute++));
  const [r] = await o<
    Row[]
  >`select status, message, value from hub.ops_checks where check_key = 'app_roles'`;
  return r as Row;
};

const user = (id: string, tenant: string, name: string, role: string) =>
  o`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale, must_change_password)
    values (${id}, ${tenant}, ${name}, ${`${name}@c19.test`}, 'x', ${name}, ${role}, 'vi', false)`;
const group = async (tenant: string, key: string): Promise<string> =>
  (
    await o<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${tenant}, ${key}, ${o.json({ vi: key })}) returning id::text as id`
  )[0]?.id as string;
const ent = (tenant: string, keys: string[]) =>
  o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select id, ${tenant}::uuid from admin.features where key = any(${o.array(keys)}::text[])
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
const grant = (tenant: string, key: string, groupId: string) =>
  o`insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select ${tenant}::uuid, id, ${groupId}::uuid from admin.features where key = ${key}`;
const role = (tenant: string, pack: string, key: string, groupId: string) =>
  o`insert into admin.app_roles (tenant_id, pack, key, name, level, group_id)
    values (${tenant}, ${pack}, ${key}, ${o.json({ vi: key })}, 'read', ${groupId})`;
const member = (tenant: string, groupId: string, user: string) =>
  o`insert into admin.group_members (tenant_id, group_id, user_id) values (${tenant}, ${groupId}, ${user})`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${T1}, 't1301', 'Quản trị thiếu'), (${T2}, 't1302', 'Vượt trần'),
    (${T3}, 't1303', 'Trùng vai hub'), (${T4}, 't1304', 'Khác công ty'), (${T5}, 't1305', 'App tắt')`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("ops-watch · app_roles · int", () => {
  let base: Row;

  it("nền: chạy được, chưa có dữ liệu lệch của test", async () => {
    base = await round();
    expect(Object.keys(base.value).sort()).toEqual(["rule1", "rule2", "rule3", "rule4", "rule5"]);
  });

  it("R1 · tenant_admin chưa có mức Quản trị ở app đang bật (trần Quản trị) ⇒ crit nêu công ty, vào nhóm có grant -admin ⇒ hết", async () => {
    await ent(T1, ["contracts-read", "contracts-write", "contracts-admin"]);
    await user(U1, T1, "c19-admin", "tenant_admin");
    const r = await round();
    expect(r.value.rule1).toBe((base.value.rule1 ?? 0) + 1);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("Quản trị thiếu");
    const g = await group(T1, "c19-owner");
    await grant(T1, "contracts-admin", g);
    await member(T1, g, U1);
    expect((await round()).value.rule1).toBe(base.value.rule1 ?? 0);
  });

  it("R2 · member có grant vượt trần mức của app ⇒ đếm (cảnh báo), nâng trần ⇒ hết", async () => {
    await ent(T2, ["contracts-read"]);
    await user(U2, T2, "c19-member", "member");
    const g = await group(T2, "c19-writers");
    await grant(T2, "contracts-write", g);
    await member(T2, g, U2);
    const r = await round();
    expect(r.value.rule2).toBe((base.value.rule2 ?? 0) + 1);
    expect(r.message).toContain("Vượt trần");
    await ent(T2, ["contracts-write"]);
    expect((await round()).value.rule2).toBe(base.value.rule2 ?? 0);
  });

  it("R3 · app_roles.key trùng tên vai hub (tenant-admin ≡ tenant_admin) ⇒ crit, đổi mã ⇒ hết", async () => {
    await ent(T3, ["contracts-read"]);
    const g = await group(T3, "c19-role");
    await role(T3, "contracts", "tenant-admin", g);
    const r = await round();
    expect(r.value.rule3).toBe((base.value.rule3 ?? 0) + 1);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("Trùng vai hub");
    await o`update admin.app_roles set key = 'quan-ly' where tenant_id = ${T3}`;
    expect((await round()).value.rule3).toBe(base.value.rule3 ?? 0);
  });

  it("R4 · thành viên Group vai app thuộc công ty khác ⇒ crit, gỡ ⇒ hết", async () => {
    await ent(T4, ["contracts-read"]);
    const g = await group(T4, "c19-xrole");
    await role(T4, "contracts", "viewer-x", g);
    await user(U4, T5, "c19-other", "member");
    // Dữ liệu sai cách ly (FK kép/trigger sẽ chặn đường thường): chèn bằng owner với session_replication_role = replica.
    await o.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${T4}, ${g}, ${U4})`;
    });
    const r = await round();
    expect(r.value.rule4).toBe((base.value.rule4 ?? 0) + 1);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("Khác công ty");
    await o`delete from admin.group_members where group_id = ${g}`;
    expect((await round()).value.rule4).toBe(base.value.rule4 ?? 0);
  });

  it("R5 · app_roles của app công ty không bật ⇒ crit, bật app ⇒ hết", async () => {
    const g = await group(T5, "c19-knowledge");
    await role(T5, "knowledge", "viewer-k", g);
    const r = await round();
    expect(r.value.rule5).toBe((base.value.rule5 ?? 0) + 1);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("App tắt");
    await ent(T5, ["knowledge-read"]);
    expect((await round()).value.rule5).toBe(base.value.rule5 ?? 0);
  });
});
