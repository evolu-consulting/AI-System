// ADM-FR-62, ADM-FR-55, ADM-BR-09 · API /admin/groups (M3-AC01; M3-R01, R02, R04, R05, R06, R23; test-plan I-G).
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset); không `it` nào đọc kết quả của `it` khác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  GroupListResponseSchema,
  GroupSchema,
  GroupVersionConflictDetailsSchema,
  TenantCreateResponseSchema,
} from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  num,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let hoa: ReturnType<typeof callerOf>;
let lan: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  hoa = callerOf(env, "globex", "hoa");
  lan = callerOf(env, "acme", "lan");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

const list = async (call: typeof admin, qs = "") => {
  const res = await call("GET", `/admin/groups${qs}`);
  expect(res.status).toBe(200);
  return GroupListResponseSchema.parse(res.json);
};
const keys = (b: { items: { key: string }[] }) => b.items.map((i) => i.key);
const getGroup = async (id: string) =>
  GroupSchema.parse((await admin("GET", `/admin/groups/${id}`)).json);
const create = (call: typeof admin, body: unknown, qs = "") =>
  call("POST", `/admin/groups${qs}`, body);
const NEW = { key: "moi-nhom", name: { vi: "Nhóm mới" } };
const count = (sql: string) => num(env.owner, sql);

describe("ADM-FR-62 · danh sách groups (M3-R23)", () => {
  it("ADM-FR-62 · M3-R23 · platform không tenant_id → mọi tenant, sắp tenant_key rồi beta-testers đầu rồi key (7 group)", async () => {
    const b = await list(admin);
    expect(b.total).toBe(7);
    expect(b.items.map((g) => `${g.tenant_key}/${g.key}`)).toEqual([
      "acme/beta-testers",
      "acme/ke-toan",
      "acme/kinh-doanh",
      "globex/beta-testers",
      "globex/ke-toan",
      "platform/beta-testers",
      "zeta/beta-testers",
    ]);
  });

  it("ADM-FR-62 · M3-R23 · ?tenant_id=acme → [beta-testers, ke-toan, kinh-doanh] với member_count [1,3,0], feature_count [1,1,0], agent_count 0, is_beta đúng", async () => {
    const b = await list(admin, `?tenant_id=${TENANT_ID.acme}`);
    expect(keys(b)).toEqual(["beta-testers", "ke-toan", "kinh-doanh"]);
    expect(b.items.map((g) => g.member_count)).toEqual([1, 3, 0]);
    expect(b.items.map((g) => g.feature_count)).toEqual([1, 1, 0]);
    expect(b.items.map((g) => g.agent_count)).toEqual([0, 0, 0]);
    expect(b.items.map((g) => g.is_beta)).toEqual([true, false, false]);
    expect(b.items.every((g) => g.tenant_key === "acme" && g.tenant_name === "Acme Corp")).toBe(
      true,
    );
  });

  it("ADM-FR-62 · M3-R23 · q khớp key, name.vi, name.en (ILIKE): 'acc' → ke-toan (en Accounting), 'KE-' → ke-toan, 'kinh' → kinh-doanh", async () => {
    const t = `?tenant_id=${TENANT_ID.acme}`;
    expect(keys(await list(admin, `${t}&q=acc`))).toEqual(["ke-toan"]);
    expect(keys(await list(admin, `${t}&q=KE-`))).toEqual(["ke-toan"]);
    expect(keys(await list(admin, `${t}&q=Kinh`))).toEqual(["kinh-doanh"]);
    expect((await list(admin, `${t}&q=khongco`)).total).toBe(0);
  });

  it("ADM-FR-62 · M3-R23 · limit/offset/total; limit=201 và offset=-1 → 400; response không có counts", async () => {
    const p = await list(admin, `?tenant_id=${TENANT_ID.acme}&limit=1&offset=1`);
    expect(keys(p)).toEqual(["ke-toan"]);
    expect(p.total).toBe(3);
    const raw = (await admin("GET", "/admin/groups")).json as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["items", "total"]);
    for (const qs of ["?limit=201", "?limit=0", "?offset=-1", "?foo=1", "?tenant_id=abc"]) {
      expectErr(await admin("GET", `/admin/groups${qs}`), "VALIDATION_ERROR");
    }
  });

  it("ADM-BR-09 · M3-R06 · tenant_admin chỉ thấy tenant mình; ?tenant_id của tenant khác bị bỏ qua (vẫn acme)", async () => {
    const own = await list(binh);
    expect(own.items.every((g) => g.tenant_key === "acme")).toBe(true);
    expect(own.total).toBe(3);
    const other = await list(binh, `?tenant_id=${TENANT_ID.globex}`);
    expect(other.items.every((g) => g.tenant_key === "acme")).toBe(true);
    expect((await list(hoa)).total).toBe(2);
  });

  it("ADM-BR-09 · M3-R06 · không token → 401 UNAUTHORIZED; member → 403 FORBIDDEN (kể cả body/tham số sai)", async () => {
    expectErr(await env.call("GET", "/admin/groups"), "UNAUTHORIZED");
    expectErr(await lan("GET", "/admin/groups"), "FORBIDDEN");
    expectErr(await lan("GET", "/admin/groups?limit=999"), "FORBIDDEN");
    expectErr(await create(lan, { sai: true }), "FORBIDDEN");
  });
});

describe("ADM-FR-62 · tạo group (M3-R01)", () => {
  it("ADM-FR-62 · M3-R01 · tenant_admin POST → 201 GroupSchema: version 1, updated_by 'binh', member_count 0, feature_count 0, description null", async () => {
    const res = await create(binh, NEW);
    expect(res.status).toBe(201);
    const g = GroupSchema.parse(res.json);
    expect(g).toMatchObject({
      key: "moi-nhom",
      tenant_key: "acme",
      version: 1,
      updated_by: "binh",
      member_count: 0,
      feature_count: 0,
      agent_count: 0,
      description: null,
      is_beta: false,
    });
    expect(g.name).toEqual({ vi: "Nhóm mới" });
  });

  it("ADM-BR-09 · M3-R06 · platform: thiếu tenant_id → 400 TENANT_REQUIRED; tenant lạ → 404; có tenant_id → 201 và updated_by 'admin'", async () => {
    expectErr(await create(admin, NEW), "TENANT_REQUIRED");
    expectErr(await create(admin, NEW, `?tenant_id=${ID3.unknown}`), "NOT_FOUND");
    const ok = await create(admin, NEW, `?tenant_id=${TENANT_ID.globex}`);
    expect(ok.status).toBe(201);
    expect(GroupSchema.parse(ok.json)).toMatchObject({ tenant_key: "globex", updated_by: "admin" });
  });

  it("ADM-FR-62 · M3-R01 · KEY_TAKEN cùng tenant (409); cùng key khác tenant → 201; tạo beta-testers → 409 KEY_TAKEN", async () => {
    expectErr(await create(binh, { key: "ke-toan", name: { vi: "Trùng" } }), "KEY_TAKEN");
    expect((await create(hoa, { key: "kinh-doanh", name: { vi: "KD" } })).status).toBe(201);
    expectErr(await create(binh, { key: "beta-testers", name: { vi: "Beta" } }), "KEY_TAKEN");
    expect(
      await count("select count(*)::int as n from admin.groups where key = 'kinh-doanh'"),
    ).toBe(2);
  });

  it("ADM-FR-62 · M3-R01 · key viết hoa 'KE-TOAN2' → lưu 'ke-toan2'", async () => {
    const g = GroupSchema.parse(
      (await create(binh, { key: "KE-TOAN2", name: { vi: "KT2" } })).json,
    );
    expect(g.key).toBe("ke-toan2");
  });

  it("ADM-FR-62 · M3-R01 · dữ liệu sai → 400 VALIDATION_ERROR và không tạo group", async () => {
    const before = await count("select count(*)::int as n from admin.groups");
    const bad: unknown[] = [
      { key: "a", name: { vi: "X" } },
      { key: "k".repeat(33), name: { vi: "X" } },
      { key: "a_b", name: { vi: "X" } },
      { key: "ok-key" },
      { key: "ok-key", name: { vi: "" } },
      { key: "ok-key", name: { vi: "x".repeat(65) } },
      { key: "ok-key", name: { vi: "X" }, description: "d".repeat(401) },
      { key: "ok-key", name: { vi: "X" }, extra: 1 },
    ];
    for (const body of bad) expectErr(await create(binh, body), "VALIDATION_ERROR");
    expect(await count("select count(*)::int as n from admin.groups")).toBe(before);
  });

  it("ADM-FR-62 · M3-R01 · description '' → null; description 400 ký tự ok", async () => {
    const a = GroupSchema.parse((await create(binh, { ...NEW, description: "" })).json);
    expect(a.description).toBeNull();
    const b = await create(binh, { key: "dai", name: { vi: "D" }, description: "d".repeat(400) });
    expect(b.status).toBe(201);
  });
});

describe("ADM-FR-62 · xem và sửa group (M3-R01, R05)", () => {
  it("ADM-FR-62 · M3-R06 · GET :id → 200 GroupSchema; tenant_admin group tenant khác → 404 (không 403); uuid lạ / 'abc' → 404", async () => {
    const g = await getGroup(ID3.group.acmeKeToan);
    expect(g.member_count).toBe(3);
    expect((await binh("GET", `/admin/groups/${ID3.group.acmeKeToan}`)).status).toBe(200);
    expectErr(await hoa("GET", `/admin/groups/${ID3.group.acmeKeToan}`), "NOT_FOUND");
    expectErr(await admin("GET", `/admin/groups/${ID3.unknown}`), "NOT_FOUND");
    expectErr(await admin("GET", "/admin/groups/abc"), "NOT_FOUND");
  });

  it("ADM-FR-55 · M3-R01 · PATCH đổi tên → 200, version+1, updated_by và updated_at đổi", async () => {
    const before = await getGroup(ID3.group.acmeKeToan);
    const res = await binh("PATCH", `/admin/groups/${ID3.group.acmeKeToan}`, {
      version: before.version,
      name: { vi: "Kế toán 2" },
    });
    expect(res.status).toBe(200);
    const g = GroupSchema.parse(res.json);
    expect(g.version).toBe(before.version + 1);
    expect(g.name).toEqual({ vi: "Kế toán 2" });
    expect(g.updated_by).toBe("binh");
    expect(g.updated_at >= before.updated_at).toBe(true);
  });

  it("ADM-FR-55 · M3-R18 · version cũ → 409 VERSION_CONFLICT, details parse GroupVersionConflictDetails; current = bản server (version 2, updated_by 'binh'); DB không đổi", async () => {
    const id = ID3.group.acmeKeToan;
    await binh("PATCH", `/admin/groups/${id}`, { version: 1, name: { vi: "Của binh" } });
    const res = await admin("PATCH", `/admin/groups/${id}`, {
      version: 1,
      name: { vi: "Của admin" },
    });
    expectErr(res, "VERSION_CONFLICT");
    const d = GroupVersionConflictDetailsSchema.parse(res.json.error.details);
    expect(d.current.version).toBe(2);
    expect(d.current.updated_by).toBe("binh");
    expect(d.current.name).toEqual({ vi: "Của binh" });
    expect(d.updated_at).toBe(d.current.updated_at);
    expect((await getGroup(id)).name).toEqual({ vi: "Của binh" });
  });

  it("ADM-FR-55 · M3-R01 · PATCH không đổi gì → 200 bản hiện tại, version và updated_at KHÔNG đổi", async () => {
    const before = await getGroup(ID3.group.acmeKeToan);
    const res = await binh("PATCH", `/admin/groups/${before.id}`, {
      version: before.version,
      name: before.name,
      description: before.description,
    });
    expect(res.status).toBe(200);
    const g = GroupSchema.parse(res.json);
    expect([g.version, g.updated_at]).toEqual([before.version, before.updated_at]);
  });

  it("ADM-FR-62 · M3-R01 · PATCH có key → 400; thiếu version → 400; description null xoá mô tả; khoá lạ → 400", async () => {
    const id = ID3.group.acmeKeToan;
    expectErr(
      await binh("PATCH", `/admin/groups/${id}`, { version: 1, key: "moi" }),
      "VALIDATION_ERROR",
    );
    expectErr(
      await binh("PATCH", `/admin/groups/${id}`, { name: { vi: "X" } }),
      "VALIDATION_ERROR",
    );
    expectErr(
      await binh("PATCH", `/admin/groups/${id}`, { version: 1, extra: 1 }),
      "VALIDATION_ERROR",
    );
    const ok = await binh("PATCH", `/admin/groups/${id}`, { version: 1, description: null });
    expect(GroupSchema.parse(ok.json).description).toBeNull();
  });

  it("ADM-FR-62 · M3-R02 · beta-testers đổi tên và mô tả được (không đổi key)", async () => {
    const id = await betaId(env.owner, "acme");
    const res = await binh("PATCH", `/admin/groups/${id}`, {
      version: 1,
      name: { vi: "Thử nghiệm" },
      description: "Mô tả mới",
    });
    expect(res.status).toBe(200);
    expect(GroupSchema.parse(res.json)).toMatchObject({
      key: "beta-testers",
      is_beta: true,
      description: "Mô tả mới",
    });
  });

  it("ADM-FR-55 · M3-R05 · thêm thành viên và cấp grant KHÔNG tăng version group, feature, user", async () => {
    const id = ID3.group.acmeKinhDoanh;
    const verOf = async () => ({
      g: await count(`select version::int as n from admin.groups where id = '${id}'`),
      f: await count(
        `select version::int as n from admin.features where id = '${ID.feature.keToan}'`,
      ),
      u: await count(`select version::int as n from admin.users where id = '${USER_ID.an}'`),
    });
    const before = await verOf();
    expect((await binh("POST", `/admin/groups/${id}/members`, { usernames: ["an"] })).status).toBe(
      200,
    );
    expect(
      (await binh("POST", "/admin/grants", { feature_id: ID.feature.keToan, group_id: id })).status,
    ).toBe(201);
    expect(await verOf()).toEqual(before);
  });

  it("ADM-BR-09 · M3-R06 · PATCH group tenant khác → 404 (tenant_admin); member → 403 trước khi tra; thứ tự 404 → version", async () => {
    const id = ID3.group.acmeKeToan;
    expectErr(
      await hoa("PATCH", `/admin/groups/${id}`, { version: 1, name: { vi: "X" } }),
      "NOT_FOUND",
    );
    expectErr(
      await lan("PATCH", `/admin/groups/${id}`, { version: 99, name: { vi: "X" } }),
      "FORBIDDEN",
    );
    expectErr(
      await hoa("PATCH", `/admin/groups/${id}`, { version: 99, name: { vi: "X" } }),
      "NOT_FOUND",
    );
  });
});

describe("ADM-FR-62 · xoá group (M3-R02, R04)", () => {
  it("ADM-FR-62 · M3-R04 · DELETE → 204; cascade xoá thành viên + grant của group; user và feature còn nguyên; GET sau đó 404", async () => {
    const id = ID3.group.acmeKeToan;
    const usersBefore = await count("select count(*)::int as n from admin.users");
    expect((await binh("DELETE", `/admin/groups/${id}`)).status).toBe(204);
    expect(
      await count(`select count(*)::int as n from admin.group_members where group_id = '${id}'`),
    ).toBe(0);
    expect(
      await count(`select count(*)::int as n from admin.feature_grants where group_id = '${id}'`),
    ).toBe(0);
    expect(await count("select count(*)::int as n from admin.users")).toBe(usersBefore);
    expect(
      await count(
        `select count(*)::int as n from admin.features where id = '${ID.feature.keToan}'`,
      ),
    ).toBe(1);
    expectErr(await admin("GET", `/admin/groups/${id}`), "NOT_FOUND");
  });

  it("ADM-FR-62 · M3-R02 · DELETE beta-testers → 409 BETA_GROUP_PROTECTED, không details; group còn nguyên", async () => {
    const id = await betaId(env.owner, "acme");
    const res = await binh("DELETE", `/admin/groups/${id}`);
    expectErr(res, "BETA_GROUP_PROTECTED");
    expect(res.json.error.details).toBeUndefined();
    expect(res.json.error.message).toBe("The beta-testers group cannot be deleted");
    expect((await admin("GET", `/admin/groups/${id}`)).status).toBe(200);
  });

  it("ADM-BR-09 · M3-R06 · DELETE: uuid lạ → 404; tenant khác → 404; member → 403; thứ tự 404 → BETA_GROUP_PROTECTED", async () => {
    expectErr(await admin("DELETE", `/admin/groups/${ID3.unknown}`), "NOT_FOUND");
    expectErr(await hoa("DELETE", `/admin/groups/${ID3.group.acmeKeToan}`), "NOT_FOUND");
    expectErr(await lan("DELETE", `/admin/groups/${ID3.group.acmeKeToan}`), "FORBIDDEN");
    const betaAcme = await betaId(env.owner, "acme");
    expectErr(await hoa("DELETE", `/admin/groups/${betaAcme}`), "NOT_FOUND");
    expectErr(await binh("DELETE", `/admin/groups/${betaAcme}`), "BETA_GROUP_PROTECTED");
  });

  it("ADM-FR-62 · M3-R02 · xoá group thường rồi tạo lại cùng key → 201 (key được giải phóng)", async () => {
    expect((await binh("DELETE", `/admin/groups/${ID3.group.acmeKinhDoanh}`)).status).toBe(204);
    expect((await create(binh, { key: "kinh-doanh", name: { vi: "KD mới" } })).status).toBe(201);
  });
});

describe("ADM-FR-62 · beta-testers của tenant (trigger, M3-R02)", () => {
  it("ADM-FR-62 · M3-R02 · POST /admin/tenants → tenant mới có ĐÚNG MỘT beta-testers (is_beta, name Beta testers)", async () => {
    const res = await admin("POST", "/admin/tenants", {
      key: "initech",
      name: "Initech",
      first_admin: {
        username: "lumbergh",
        display_name: "Bill",
        email: "bill@initech.test",
        locale: "en",
      },
    });
    expect(res.status).toBe(201);
    const t = TenantCreateResponseSchema.parse(res.json).tenant;
    const b = await list(admin, `?tenant_id=${t.id}`);
    expect(b.items.map((g) => [g.key, g.is_beta, g.member_count])).toEqual([
      ["beta-testers", true, 0],
    ]);
    expect(b.items[0]?.name).toEqual({ vi: "Beta testers", en: "Beta testers" });
  });

  it("ADM-FR-62 · M3-R02 · tạo tenant lỗi KEY_TAKEN → không có group mồ côi (mọi group đều có tenant; số beta-testers = số tenant)", async () => {
    const res = await admin("POST", "/admin/tenants", {
      key: "acme",
      name: "Trùng",
      first_admin: { username: "boss", display_name: "Boss", email: "boss@x.test" },
    });
    expectErr(res, "KEY_TAKEN");
    expect(
      await count("select count(*)::int as n from admin.groups where key = 'beta-testers'"),
    ).toBe(await count("select count(*)::int as n from admin.tenants"));
  });

  it("ADM-FR-62 · M3-R02 · mọi tenant fixture (platform, acme, globex, zeta) có beta-testers", async () => {
    const b = await list(admin);
    const betas = b.items.filter((g) => g.is_beta).map((g) => g.tenant_key);
    expect(betas).toEqual(["acme", "globex", "platform", "zeta"]);
  });
});
