// ADM-FR-62, ADM-FR-53 · groups.service gọi trực tiếp (không qua HTTP): bump config_version đúng lúc, dry_run không ghi,
// beta-testers bảo vệ, thêm thành viên đồng thời hai chiều không deadlock. qc có M3-AC01/02 qua API.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { addMembers } from "./groups.members";
import { type Call, createGroup, deleteGroup, updateGroup } from "./groups.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-0000000ee001";
const ADMIN = "01900000-0000-7000-8000-0000000ee011";
const U1 = "01900000-0000-7000-8000-0000000ee012";
const U2 = "01900000-0000-7000-8000-0000000ee013";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 4 });
const call: Call = {
  ctx: { db },
  actor: { userId: ADMIN, tenantId: TID, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: TID },
};
const cfg = async () =>
  (await owner<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ?? -1;
const user = (id: string, name: string, role = "member") =>
  owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${id}, ${TID}, ${name}, 'x', ${name}, ${role}, ${`${name}@x.test`})`;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'acme', 'Acme')`;
  await user(ADMIN, "binh", "tenant_admin");
  await user(U1, "lan");
  await user(U2, "thu");
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("ADM-FR-62 · groups.service", () => {
  test("tạo +1 config; PATCH không đổi gì không bump; beta-testers không xoá được", async () => {
    const v0 = await cfg();
    const g = await createGroup(call, undefined, {
      key: "ke-toan",
      name: { vi: "KT" },
      description: null,
    });
    expect(await cfg()).toBe(v0 + 1);
    await updateGroup(call, g.id, { version: 1, name: { vi: "KT" } });
    expect(await cfg()).toBe(v0 + 1);
    const [beta] = await owner`select id from admin.groups where key = 'beta-testers'`;
    const err = await deleteGroup(call, beta?.id as string).catch((e) => e);
    expect(isAppError(err, "BETA_GROUP_PROTECTED")).toBe(true);
  });

  test("dry_run không ghi, không bump; thêm thật bump đúng một lần", async () => {
    const g = await createGroup(call, undefined, {
      key: "kd",
      name: { vi: "KD" },
      description: null,
    });
    const v0 = await cfg();
    const dry = await addMembers(call, g.id, { usernames: ["lan", "ghost"], dry_run: true });
    expect(dry).toEqual({ added: ["lan"], not_found: ["ghost"], already: [] });
    expect(await cfg()).toBe(v0);
    await addMembers(call, g.id, { usernames: ["lan", "thu"], dry_run: false });
    expect(await cfg()).toBe(v0 + 1);
    const again = await addMembers(call, g.id, { usernames: ["thu", "lan"], dry_run: false });
    expect(again).toEqual({ added: [], not_found: [], already: ["thu", "lan"] });
    expect(await cfg()).toBe(v0 + 1);
  });

  test("hai request thêm cùng tập theo thứ tự ngược nhau chạy song song → không lỗi, tổng added = 2", async () => {
    const g = await createGroup(call, undefined, {
      key: "ss",
      name: { vi: "SS" },
      description: null,
    });
    const [a, b] = await Promise.all([
      addMembers(call, g.id, { usernames: ["thu", "lan"], dry_run: false }),
      addMembers(call, g.id, { usernames: ["lan", "thu"], dry_run: false }),
    ]);
    expect(a.added.length + b.added.length).toBe(2);
    expect([...a.added, ...a.already].sort()).toEqual(["lan", "thu"]);
  });
});
