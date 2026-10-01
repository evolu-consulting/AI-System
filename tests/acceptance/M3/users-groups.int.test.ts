// ADM-FR-62, ADM-BR-09 · `User` có `groups[]`/`group_count` ở mọi response + lọc `?group=` (M3-R13; test-plan I-UG).
// Trường mới đọc qua `newField` (typecheck xanh trước T4); `UserSchema.parse` lúc chạy kiểm strict.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { UserCreateResponseSchema, UserListResponseSchema, UserSchema } from "@ai/contracts";
import {
  callerOf,
  createM3Env,
  expectErr,
  ID3,
  type M3Env,
  newField,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let hoa: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  hoa = callerOf(env, "globex", "hoa");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

type G = { id: string; key: string; is_beta: boolean };
const groupsOf = (u: unknown) => newField<G[]>(u, "groups");
const gKeys = (u: unknown) => groupsOf(u).map((g) => g.key);
const countOf = (u: unknown) => newField<number>(u, "group_count");
const getUser = async (call: typeof admin, id: string) => {
  const res = await call("GET", `/admin/users/${id}`);
  expect(res.status).toBe(200);
  return UserSchema.parse(res.json);
};
const listUsers = async (call: typeof admin, qs = "") => {
  const res = await call("GET", `/admin/users${qs}`);
  expect(res.status).toBe(200);
  return UserListResponseSchema.parse(res.json);
};
const usernames = (b: { items: { username: string }[] }) => b.items.map((u) => u.username);

describe("ADM-FR-62 · groups/group_count ở mọi response user (M3-R13)", () => {
  it("ADM-FR-62 · M3-R13 · GET :id: thu ở [beta-testers, ke-toan] (beta đầu), group_count 2; an chưa ở group nào → [] và 0", async () => {
    const thu = await getUser(binh, USER_ID.thu);
    expect(gKeys(thu)).toEqual(["beta-testers", "ke-toan"]);
    expect(groupsOf(thu).map((g) => g.is_beta)).toEqual([true, false]);
    expect(countOf(thu)).toBe(2);
    const an = await getUser(binh, USER_ID.an);
    expect([gKeys(an), countOf(an)]).toEqual([[], 0]);
  });

  it("ADM-FR-62 · M3-R13 · list: mọi item có groups + group_count; lan ở [ke-toan]", async () => {
    const b = await listUsers(binh);
    expect(b.items.every((u) => Array.isArray(groupsOf(u)) && typeof countOf(u) === "number")).toBe(
      true,
    );
    const lan = b.items.find((u) => u.username === "lan");
    expect(gKeys(lan)).toEqual(["ke-toan"]);
  });

  it("ADM-FR-62 · M3-R13 · POST /admin/users → user mới groups [] và group_count 0", async () => {
    const res = await binh("POST", "/admin/users", {
      username: "moi",
      display_name: "Moi",
      role: "member",
    });
    expect(res.status).toBe(201);
    const u = UserCreateResponseSchema.parse(res.json).user;
    expect([gKeys(u), countOf(u)]).toEqual([[], 0]);
  });

  it("ADM-FR-62 · M3-R13 · PATCH, lock, unlock đều trả User có groups + group_count đúng", async () => {
    const thu = await getUser(binh, USER_ID.thu);
    const patched = UserSchema.parse(
      (
        await binh("PATCH", `/admin/users/${USER_ID.thu}`, {
          version: thu.version,
          display_name: "Thu Ha 2",
        })
      ).json,
    );
    expect(gKeys(patched)).toEqual(["beta-testers", "ke-toan"]);
    const locked = UserSchema.parse((await binh("POST", `/admin/users/${USER_ID.thu}/lock`)).json);
    expect(countOf(locked)).toBe(2);
    const unlocked = UserSchema.parse(
      (await binh("POST", `/admin/users/${USER_ID.thu}/unlock`)).json,
    );
    expect(gKeys(unlocked)).toEqual(["beta-testers", "ke-toan"]);
  });

  it("ADM-FR-55 · M3-R13 · VERSION_CONFLICT.details.current của user cũng có groups + group_count", async () => {
    const lan = await getUser(binh, USER_ID.lan);
    await binh("PATCH", `/admin/users/${USER_ID.lan}`, {
      version: lan.version,
      display_name: "Lan A",
    });
    const res = await binh("PATCH", `/admin/users/${USER_ID.lan}`, {
      version: lan.version,
      display_name: "Lan B",
    });
    expectErr(res, "VERSION_CONFLICT");
    const cur = UserSchema.parse(res.json.error.details.current);
    expect(gKeys(cur)).toEqual(["ke-toan"]);
    expect(countOf(cur)).toBe(1);
  });

  it("ADM-FR-62 · M3-R13 · user ở 52 group → groups đúng 50 (beta đầu rồi key tăng), group_count 52", async () => {
    const keys = Array.from({ length: 51 }, (_, i) => `nhom-${String(i).padStart(2, "0")}`);
    for (const k of keys) {
      const [g] = await env.owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
        values (${TENANT_ID.acme}, ${k}, '{"vi":"x"}'::jsonb) returning id`;
      await env.owner`insert into admin.group_members (tenant_id, group_id, user_id)
        values (${TENANT_ID.acme}, ${g?.id as string}, ${USER_ID.an})`;
    }
    const [beta] = await env.owner<{ id: string }[]>`select id from admin.groups
      where tenant_id = ${TENANT_ID.acme} and key = 'beta-testers'`;
    await env.owner`insert into admin.group_members (tenant_id, group_id, user_id)
      values (${TENANT_ID.acme}, ${beta?.id as string}, ${USER_ID.an})`;
    const an = await getUser(binh, USER_ID.an);
    expect(groupsOf(an)).toHaveLength(50);
    expect(countOf(an)).toBe(52);
    expect(gKeys(an)[0]).toBe("beta-testers");
    expect(gKeys(an).slice(1)).toEqual(keys.slice(0, 49));
  });

  it("ADM-BR-09 · M3-R13 · tenant_admin globex xem khang: groups chỉ là group của globex (id globex ke-toan)", async () => {
    const khang = await getUser(hoa, USER_ID.khang);
    expect(groupsOf(khang).map((g) => [g.key, g.id])).toEqual([
      ["ke-toan", ID3.group.globexKeToan],
    ]);
  });
});

describe("ADM-FR-62 · lọc ?group= (M3-R13)", () => {
  it("ADM-FR-62 · M3-R13 · ?group=<ke-toan acme> → lan, thu, em; kết hợp ?q=th → thu", async () => {
    const g = ID3.group.acmeKeToan;
    expect(usernames(await listUsers(binh, `?group=${g}`))).toEqual(["em", "lan", "thu"]);
    expect(usernames(await listUsers(binh, `?group=${g}&q=th`))).toEqual(["thu"]);
  });

  it("ADM-FR-62 · M3-R13 · group tenant khác (tenant_admin) hoặc uuid lạ → danh sách RỖNG (không 404); ?group=abc → 400", async () => {
    for (const g of [ID3.group.globexKeToan, ID3.unknown]) {
      const b = await listUsers(binh, `?group=${g}`);
      expect([b.items.length, b.total]).toEqual([0, 0]);
    }
    expectErr(await binh("GET", "/admin/users?group=abc"), "VALIDATION_ERROR");
  });

  it("ADM-FR-62 · M3-R13 · counts của M1 không đổi theo ?group=; platform lọc theo group acme chỉ thấy user acme", async () => {
    const all = await listUsers(binh);
    const filtered = await listUsers(binh, `?group=${ID3.group.acmeKeToan}`);
    expect(filtered.counts).toEqual(all.counts);
    const asAdmin = await listUsers(admin, `?group=${ID3.group.acmeKeToan}`);
    expect(asAdmin.items.every((u) => u.tenant_key === "acme")).toBe(true);
    expect(asAdmin.total).toBe(3);
  });
});
