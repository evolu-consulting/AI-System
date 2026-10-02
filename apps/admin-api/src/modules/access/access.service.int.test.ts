// ADM-FR-36, ADM-BR-11 · effectiveAccess gọi trực tiếp = SQL tham chiếu (plan §3.2, chạy bằng hub_ro), 404 chéo tenant,
// visibleUserCounts = số user thấy theo effectiveAccess. qc có ma trận 68 tổ hợp ở access-sql.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations, withScope } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import * as repo from "./access.repo";
import { effectiveAccess } from "./access.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-0000000ab${String(n).padStart(3, "0")}`;
const [T1, T2] = [id(1), id(2)];
const [ADMIN, LAN, AN, KHANG] = [id(11), id(12), id(13), id(14)];
const [G1, CORE, KT, WF, SEC, DICH, KTCMD] = [
  id(21),
  id(31),
  id(32),
  id(41),
  id(42),
  id(51),
  id(52),
];
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 3 });
const call = {
  ctx: { db },
  actor: { userId: ADMIN, tenantId: T1, role: "tenant_admin" as const },
  scope: { kind: "tenant" as const, tenantId: T1 },
};

const REF = `select distinct c.name from admin.users u join admin.tenants t on t.id = u.tenant_id and t.active
  cross join admin.feature_commands fc join admin.commands c on c.id = fc.command_id and c.enabled
  join admin.workflows w on w.id = c.workflow_id and w.enabled join admin.features f on f.id = fc.feature_id
  where u.id = $1 and u.active and not u.locked_by_tenant
    and (f.status = 'on' or (f.status = 'beta' and exists (select 1 from admin.group_members m
      join admin.groups g on g.id = m.group_id where m.user_id = u.id and g.key = 'beta-testers')))
    and (f.key = 'core' or (exists (select 1 from admin.feature_entitlements e where e.feature_id = f.id
      and e.tenant_id = u.tenant_id and e.revoked_at is null) and exists (select 1 from admin.feature_grants fg
      where fg.feature_id = f.id and fg.tenant_id = u.tenant_id and (fg.user_id = u.id or fg.group_id in
      (select m.group_id from admin.group_members m where m.user_id = u.id))))) order by 1`;

async function hubSees(uid: string): Promise<string[]> {
  return owner.begin(async (tx) => {
    await tx.unsafe("set local role hub_ro");
    return (await tx.unsafe(REF, [uid])).map((r) => r.name as string);
  }) as Promise<string[]>;
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${T1}, 'acme', 'Acme'), (${T2}, 'globex', 'G')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email) values
    (${ADMIN}, ${T1}, 'binh', 'x', 'B', 'tenant_admin', 'b@x.test'), (${LAN}, ${T1}, 'lan', 'x', 'L', 'member', null),
    (${AN}, ${T1}, 'an', 'x', 'A', 'member', null), (${KHANG}, ${T2}, 'khang', 'x', 'K', 'member', null)`;
  await owner`insert into admin.groups (id, tenant_id, key, name) values (${G1}, ${T1}, 'kt', '{"vi":"KT"}')`;
  await owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${T1}, ${G1}, ${LAN})`;
  await owner`insert into admin.features (id, key, name) values (${CORE}, 'core', '{"vi":"C"}'), (${KT}, 'ke-toan', '{"vi":"KT"}')`;
  await owner`insert into admin.feature_entitlements (feature_id, tenant_id) values (${KT}, ${T1})`;
  await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${T1}, ${KT}, ${G1})`;
  await owner`insert into admin.secrets (id, name, ciphertext, iv, last4) values (${SEC}, 'KEY', ${Buffer.alloc(40)}, ${Buffer.alloc(12)}, 'abcd')`;
  await owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
    values (${WF}, 'wf', 'W', ${"d".repeat(20)}, 'workflow', 'https://x.test', ${SEC})`;
  await owner`insert into admin.commands (id, name, description, workflow_id, output) values
    (${DICH}, 'dich', '{"vi":"D"}', ${WF}, '{"field":"x","render":"text"}'),
    (${KTCMD}, 'kiemtra-hoadon', '{"vi":"K"}', ${WF}, '{"field":"x","render":"text"}')`;
  await owner`insert into admin.feature_commands (feature_id, command_id) values (${CORE}, ${DICH}), (${KT}, ${KTCMD})`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("ADM-FR-36 · effectiveAccess = SQL tham chiếu", () => {
  test("lan (thành viên kt) thấy kiemtra-hoadon; an chỉ dich + gợi ý ke-toan; khớp hub_ro", async () => {
    for (const uid of [LAN, AN]) {
      const r = await effectiveAccess(call, uid, {});
      expect(r.commands.filter((c) => c.visible).map((c) => c.name)).toEqual(await hubSees(uid));
    }
    const an = await effectiveAccess(call, AN, { command: "kiemtra-hoadon" });
    expect(an.commands[0]?.suggestion?.feature.key).toBe("ke-toan");
  });

  test("tenant_admin xem user tenant khác → 404", async () => {
    const err = await effectiveAccess(call, KHANG, {}).catch((e) => e);
    expect(isAppError(err, "NOT_FOUND")).toBe(true);
  });

  test("visibleUserCounts: acme thấy kiemtra-hoadon = 1 (lan), dich = 3", async () => {
    const counts = (cmd: string) =>
      withScope(db, { kind: "platform" }, (tx) => repo.visibleUserCounts(tx, cmd, [T1, T2]));
    expect((await counts(KTCMD)).get(T1)).toBe(1);
    expect((await counts(DICH)).get(T1)).toBe(3);
    expect((await counts(DICH)).get(T2)).toBe(1);
  });
});
