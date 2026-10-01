// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-BR-06, ADM-BR-10 · API /admin/features + entitlement
// (test-plan F; M2-AC04, M2-AC05; M2-R19…R22, R24, R25). Command dựng bằng owner SQL (T4: chưa có module commands).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  EntitlementSchema,
  FeatureDetailSchema,
  FeatureListResponseSchema,
  versionConflictDetailsSchema,
} from "@ai/contracts";
import { ALL_CATALOG, ID } from "./_data";
import { createM2Env, expectErr, type Json, type M2Env, type Res, TENANT_ID } from "./_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(ALL_CATALOG);
});

const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const KT = ID.feature.keToan;
const CMD = ID.command;
const cmdVersion = async (id: string): Promise<number> =>
  ((await env.owner`select version from admin.commands where id = ${id}`)[0] as Json).version;
const featVersion = async (id: string): Promise<number> =>
  ((await env.owner`select version from admin.features where id = ${id}`)[0] as Json).version;
const featCommands = async (fid: string): Promise<string[]> =>
  (await env.owner`select command_id from admin.feature_commands where feature_id = ${fid}`)
    .map((r) => r.command_id as string)
    .sort();
const ent = async (fid: string, tid: string) =>
  (await env.owner`select * from admin.feature_entitlements where feature_id = ${fid} and tenant_id = ${tid}`) as Json[];
const patch = (id: string, version: number, body: Record<string, unknown>) =>
  as("PATCH", `/admin/features/${id}`, { version, ...body });

describe("ADM-FR-30 · tạo feature (POST)", () => {
  it("ADM-FR-30 · M2-R20 · POST với command_ids → 201 FeatureDetail; mặc định icon/description; version command được thêm tăng 1", async () => {
    const [vDich, vTom] = [await cmdVersion(CMD.dich), await cmdVersion(CMD.tomTat)];
    const res = await as("POST", "/admin/features", {
      key: "nhan-su",
      name: { vi: "Nhân sự" },
      status: "on",
      command_ids: [CMD.dich, CMD.tomTat],
    });
    expect(res.status).toBe(201);
    const f = FeatureDetailSchema.parse(res.json);
    expect(f).toMatchObject({
      key: "nhan-su",
      icon: "package",
      description: {},
      status: "on",
      is_core: false,
      tenant_count: 0,
      command_count: 2,
      version: 1,
      updated_by: "admin",
    });
    expect(f.commands.map((c) => c.name)).toEqual(["dich", "tom-tat"]);
    expect(f.commands.every((c) => c.feature_count === 2)).toBe(true);
    expect([await cmdVersion(CMD.dich), await cmdVersion(CMD.tomTat)]).toEqual([
      vDich + 1,
      vTom + 1,
    ]);
  });

  it("ADM-FR-30 · M2-R20 · validate: key sai, tên rỗng/65 ký tự, icon sai, command_ids trùng → 400 VALIDATION_ERROR", async () => {
    const ok = { key: "nhan-su", name: { vi: "Nhân sự" } };
    for (const bad of [
      { ...ok, key: "Nhan Su" },
      { ...ok, key: "n" },
      { ...ok, name: { vi: "" } },
      { ...ok, name: { vi: "x".repeat(65) } },
      { ...ok, icon: "Package" },
      { ...ok, status: "disabled" },
      { ...ok, command_ids: [CMD.dich, CMD.dich] },
      { ...ok, extra: 1 },
    ]) {
      expectErr(await as("POST", "/admin/features", bad), "VALIDATION_ERROR");
    }
  });

  it("ADM-FR-30 · M2-R20 · command_ids chứa uuid lạ → 400 INVALID_REFERENCE {field:'command_ids', ids} và KHÔNG tạo feature", async () => {
    const res = await as("POST", "/admin/features", {
      key: "nhan-su",
      name: { vi: "Nhân sự" },
      command_ids: [CMD.dich, ID.unknown],
    });
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details).toEqual({ field: "command_ids", ids: [ID.unknown] });
    expect((await env.owner`select 1 from admin.features where key = 'nhan-su'`).length).toBe(0);
  });

  it("ADM-FR-30 · M2-R20 · key trùng (core, Ke-Toan viết hoa) → 409 KEY_TAKEN với message 'Key is already taken'", async () => {
    for (const key of ["core", "Ke-Toan"]) {
      const res = await as("POST", "/admin/features", { key, name: { vi: "X" } });
      expectErr(res, "KEY_TAKEN");
      expect(res.json.error.message).toBe("Key is already taken");
    }
  });
});

describe("ADM-FR-30 · đọc và danh sách", () => {
  it("ADM-FR-33 · M2-R24 · GET /:id → FeatureDetail; affected_user_count: core = mọi tenant (11), ke-toan = acme (6)", async () => {
    const core = await as("GET", `/admin/features/${await env.coreId()}`);
    const c = FeatureDetailSchema.parse(core.json);
    expect(c).toMatchObject({ is_core: true, tenant_count: 0, affected_user_count: 11 });
    expect(c.commands.map((x) => x.name)).toEqual(["dich", "tom-tat"]);
    const kt = FeatureDetailSchema.parse((await as("GET", `/admin/features/${KT}`)).json);
    expect(kt).toMatchObject({ tenant_count: 1, command_count: 1, affected_user_count: 6 });
    expect(kt.commands[0]).toMatchObject({
      name: "kiemtra-hoadon",
      enabled: true,
      feature_count: 1,
    });
  });

  it("ADM-FR-30 · M2-R26 · :id lạ hoặc không phải uuid → 404 NOT_FOUND, body giống từng byte", async () => {
    const a = await as("GET", `/admin/features/${ID.unknown}`);
    const b = await as("GET", "/admin/features/abc");
    expectErr(a, "NOT_FOUND");
    expectErr(b, "NOT_FOUND");
    expect(a.text).toBe(b.text);
  });

  it("ADM-FR-30 · M2-R26 · list: core đầu rồi theo key; command_count/tenant_count; counts {all:5,on:3,beta:1,off:1}", async () => {
    const res = await as("GET", "/admin/features");
    const body = FeatureListResponseSchema.parse(res.json);
    expect(body.items.map((f) => f.key)).toEqual([
      "core",
      "bao-cao",
      "dich-thuat",
      "ke-toan",
      "thu-nghiem",
    ]);
    expect(body.counts).toEqual({ all: 5, on: 3, beta: 1, off: 1 });
    const by = Object.fromEntries(body.items.map((f) => [f.key, f]));
    expect([by.core?.command_count, by.core?.tenant_count, by.core?.is_core]).toEqual([2, 0, true]);
    expect([by["ke-toan"]?.command_count, by["ke-toan"]?.tenant_count]).toEqual([1, 1]);
    expect([by["thu-nghiem"]?.command_count, by["thu-nghiem"]?.tenant_count]).toEqual([0, 1]);
  });

  it("ADM-FR-34 · M2-R26 · ?status=beta lọc đúng và counts KHÔNG đổi; q khớp key/name.vi/name.en; status lạ → 400", async () => {
    const beta = await as("GET", "/admin/features?status=beta");
    expect(beta.json.items.map((f: Json) => f.key)).toEqual(["bao-cao"]);
    expect(beta.json.counts).toEqual({ all: 5, on: 3, beta: 1, off: 1 });
    const byEn = await as("GET", "/admin/features?q=accounting");
    expect(byEn.json.items.map((f: Json) => f.key)).toEqual(["ke-toan"]);
    const byVi = await as("GET", "/admin/features?q=Dịch");
    expect(byVi.json.items.map((f: Json) => f.key)).toEqual(["dich-thuat"]);
    const byKey = await as("GET", "/admin/features?q=thu-ng");
    expect(byKey.json.items.map((f: Json) => f.key)).toEqual(["thu-nghiem"]);
    expectErr(await as("GET", "/admin/features?status=disabled"), "VALIDATION_ERROR");
    expectErr(await as("GET", "/admin/features?limit=201"), "VALIDATION_ERROR");
  });

  it("ADM-FR-30 · M2-R20 · icon null trong DB → API trả 'package'", async () => {
    await env.owner`update admin.features set icon = null where id = ${KT}`;
    const res = await as("GET", `/admin/features/${KT}`);
    expect(res.json.icon).toBe("package");
  });
});

describe("ADM-FR-30 · PATCH và version", () => {
  it("ADM-FR-30 · M2-R25 · PATCH name → 200 version+1; version cũ → 409 VERSION_CONFLICT {current: FeatureDetail, updated_at}", async () => {
    const ok = await patch(KT, 1, { name: { vi: "Kế toán 2" } });
    expect(ok.status).toBe(200);
    expect(FeatureDetailSchema.parse(ok.json)).toMatchObject({ version: 2, updated_by: "admin" });
    const stale = await patch(KT, 1, { name: { vi: "Kế toán 3" } });
    expectErr(stale, "VERSION_CONFLICT");
    const d = versionConflictDetailsSchema(FeatureDetailSchema).parse(stale.json.error.details);
    expect(d.updated_at).toBe(d.current.updated_at);
    expect(d.current.version).toBe(2);
  });

  it("ADM-FR-30 · M2-R25 · không đổi gì → 200 bản hiện tại, version và updated_at KHÔNG đổi; en rỗng bị bỏ", async () => {
    const before = (await as("GET", `/admin/features/${KT}`)).json;
    const same = await patch(KT, before.version, { name: { vi: "Kế toán", en: "Accounting" } });
    expect(same.status).toBe(200);
    expect(same.json.version).toBe(before.version);
    expect(same.json.updated_at).toBe(before.updated_at);
    const noEn = await patch(KT, before.version, { name: { vi: "Kế toán", en: "  " } });
    expect(noEn.json.name).toEqual({ vi: "Kế toán" });
    expect(noEn.json.version).toBe(before.version + 1);
  });

  it("ADM-FR-30 · M2-R25 · key trong body / thiếu version / trường lạ → 400 VALIDATION_ERROR; :id lạ → 404", async () => {
    expectErr(await patch(KT, 1, { key: "khac" }), "VALIDATION_ERROR");
    expectErr(
      await as("PATCH", `/admin/features/${KT}`, { name: { vi: "X" } }),
      "VALIDATION_ERROR",
    );
    expectErr(await patch(KT, 1, { foo: 1 }), "VALIDATION_ERROR");
    expectErr(await patch(ID.unknown, 1, { name: { vi: "X" } }), "NOT_FOUND");
  });

  it("ADM-FR-33 · ADM-FR-34 · BR-06 · M2-R24 · status on→off→beta→on mỗi lần version+1; tắt feature KHÔNG đổi enabled của command, hàng còn nguyên", async () => {
    let v = 1;
    for (const status of ["off", "beta", "on"]) {
      const res = await patch(KT, v, { status });
      expect(res.status).toBe(200);
      expect(res.json.status).toBe(status);
      expect(res.json.version).toBe(v + 1);
      v += 1;
      if (status === "off") {
        const [c] =
          await env.owner`select enabled from admin.commands where id = ${CMD.kiemtraHoadon}`;
        expect(c?.enabled).toBe(true);
        expect(await featCommands(KT)).toEqual([CMD.kiemtraHoadon]);
      }
    }
  });
});

describe("ADM-BR-10 · core được bảo vệ (M2-R20)", () => {
  it("ADM-BR-10 · M2-R20 · PATCH core status off/beta → 409 CORE_FEATURE_PROTECTED; 'on' → 200 không đổi", async () => {
    const core = await env.coreId();
    for (const status of ["off", "beta"]) {
      expectErr(await patch(core, 1, { status }), "CORE_FEATURE_PROTECTED");
    }
    const same = await patch(core, 1, { status: "on" });
    expect(same.status).toBe(200);
    expect(same.json.version).toBe(1);
  });

  it("ADM-BR-10 · M2-R20 · core vẫn sửa được tên/mô tả/icon", async () => {
    const core = await env.coreId();
    const res = await patch(core, 1, {
      name: { vi: "Cơ bản 2" },
      icon: "home",
      description: { vi: "Mô tả core" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ icon: "home", description: { vi: "Mô tả core" }, version: 2 });
  });

  it("ADM-BR-10 · M2-R20 · DELETE core → 409 CORE_FEATURE_PROTECTED (kể cả khi core rỗng); thứ tự CORE thắng INVALID_REFERENCE", async () => {
    const core = await env.coreId();
    expectErr(await as("DELETE", `/admin/features/${core}`), "CORE_FEATURE_PROTECTED");
    await env.owner`delete from admin.feature_commands where feature_id = ${core}`;
    expectErr(await as("DELETE", `/admin/features/${core}`), "CORE_FEATURE_PROTECTED");
    expect((await env.owner`select 1 from admin.features where id = ${core}`).length).toBe(1);
    expectErr(
      await patch(core, 1, { status: "off", command_ids: [ID.unknown] }),
      "CORE_FEATURE_PROTECTED",
    );
  });
});

describe("ADM-BR-10 · command_ids thay cả tập (M2-R19)", () => {
  it("ADM-FR-30 · M2-R25 · PATCH command_ids: thêm tom-tat → version tom-tat+1, kiemtra không đổi, version feature+1", async () => {
    const [vt, vk, vf] = [
      await cmdVersion(CMD.tomTat),
      await cmdVersion(CMD.kiemtraHoadon),
      await featVersion(KT),
    ];
    const res = await patch(KT, vf, { command_ids: [CMD.kiemtraHoadon, CMD.tomTat] });
    expect(res.status).toBe(200);
    expect(res.json.commands.map((c: Json) => c.name)).toEqual(["kiemtra-hoadon", "tom-tat"]);
    expect(await cmdVersion(CMD.tomTat)).toBe(vt + 1);
    expect(await cmdVersion(CMD.kiemtraHoadon)).toBe(vk);
    expect(await featVersion(KT)).toBe(vf + 1);
  });

  it("ADM-BR-10 · M2-AC04 · bỏ command CHỈ thuộc feature này → 400 COMMAND_NEEDS_FEATURE {commands:[{id,name}]}; DB không đổi", async () => {
    const [vk, vf] = [await cmdVersion(CMD.kiemtraHoadon), await featVersion(KT)];
    const res = await patch(KT, vf, { command_ids: [CMD.tomTat] });
    expectErr(res, "COMMAND_NEEDS_FEATURE");
    expect(res.json.error.details).toEqual({
      commands: [{ id: CMD.kiemtraHoadon, name: "kiemtra-hoadon" }],
    });
    expect(await featCommands(KT)).toEqual([CMD.kiemtraHoadon]);
    expect(await cmdVersion(CMD.kiemtraHoadon)).toBe(vk);
    expect(await featVersion(KT)).toBe(vf);
  });

  it("ADM-BR-10 · M2-R19 · bỏ command còn feature khác → được; version command bị bỏ +1", async () => {
    const core = await env.coreId();
    const vt = await cmdVersion(CMD.tomTat);
    const res = await patch(core, 1, { command_ids: [CMD.dich] });
    expect(res.status).toBe(200);
    expect(await featCommands(core)).toEqual([CMD.dich]);
    expect(await cmdVersion(CMD.tomTat)).toBe(vt + 1);
  });

  it("ADM-BR-10 · M2-R19 · thứ tự kiểm: id lạ + command mồ côi cùng lúc → INVALID_REFERENCE; cùng tập (khác thứ tự) → không tăng version", async () => {
    const res = await patch(KT, 1, { command_ids: [ID.unknown] });
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details).toMatchObject({ field: "command_ids", ids: [ID.unknown] });
    const core = await env.coreId();
    const same = await patch(core, 1, { command_ids: [CMD.tomTat, CMD.dich] });
    expect(same.status).toBe(200);
    expect(same.json.version).toBe(1);
  });
});

describe("ADM-FR-30 · xoá feature (M2-R21)", () => {
  it("ADM-FR-30 · M2-AC04 · feature có command độc quyền → 409 FEATURE_HAS_EXCLUSIVE_COMMANDS {commands}; DB giữ nguyên", async () => {
    const a = await as("DELETE", `/admin/features/${KT}`);
    expectErr(a, "FEATURE_HAS_EXCLUSIVE_COMMANDS");
    expect(a.json.error.details).toEqual({
      commands: [{ id: CMD.kiemtraHoadon, name: "kiemtra-hoadon" }],
    });
    const b = await as("DELETE", `/admin/features/${ID.feature.dichThuat}`);
    expectErr(b, "FEATURE_HAS_EXCLUSIVE_COMMANDS");
    expect(b.json.error.details.commands[0].name).toBe("tr-nhanh");
    expect((await env.owner`select 1 from admin.features where id = ${KT}`).length).toBe(1);
  });

  it("ADM-FR-30 · M2-R21 · feature rỗng có entitlement → 204; feature_entitlements và feature_commands của nó bị xoá theo; command còn nguyên", async () => {
    const res = await as("DELETE", `/admin/features/${ID.feature.thuNghiem}`);
    expect(res.status).toBe(204);
    expect(
      (
        await env.owner`select 1 from admin.feature_entitlements where feature_id = ${ID.feature.thuNghiem}`
      ).length,
    ).toBe(0);
    expect((await env.owner`select 1 from admin.commands`).length).toBe(5);
    expectErr(await as("GET", `/admin/features/${ID.feature.thuNghiem}`), "NOT_FOUND");
  });

  it("ADM-FR-30 · M2-R21 · feature mà mọi command còn feature khác → 204; command còn nguyên với core", async () => {
    const created = await as("POST", "/admin/features", {
      key: "nhan-su",
      name: { vi: "Nhân sự" },
      command_ids: [CMD.dich],
    });
    expect((await as("DELETE", `/admin/features/${created.json.id}`)).status).toBe(204);
    expect(await featCommands(await env.coreId())).toContain(CMD.dich);
    expectErr(await as("DELETE", `/admin/features/${ID.unknown}`), "NOT_FOUND");
  });
});

describe("ADM-FR-31 · entitlement (M2-R22, M2-AC05)", () => {
  it("ADM-FR-31 · M2-R22 · PUT → 200 Entitlement (granted_by 'admin', tenant_active, active_user_count); lần 2 idempotent (granted_at không đổi); tenant khoá vẫn cấp được", async () => {
    const res = await as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`);
    expect(res.status).toBe(200);
    expect(EntitlementSchema.parse(res.json)).toMatchObject({
      tenant_key: "zeta",
      tenant_active: false,
      active_user_count: 0,
      granted_by: "admin",
    });
    const again = await as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`);
    expect(again.status).toBe(200);
    expect(again.json.granted_at).toBe(res.json.granted_at);
    expect((await ent(KT, TENANT_ID.zeta)).length).toBe(1);
  });

  it("ADM-FR-31 · M2-R22 · GET …/entitlements: chỉ hàng chưa thu hồi, sắp tenant_key, {items,total}, q và phân trang", async () => {
    await as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`);
    const res = await as("GET", `/admin/features/${KT}/entitlements`);
    expect(res.status).toBe(200);
    expect(res.json.items.map((e: Json) => e.tenant_key)).toEqual(["acme", "zeta"]);
    expect(res.json.total).toBe(2);
    expect(res.json.items[0]).toMatchObject({ active_user_count: 6, tenant_active: true });
    const q = await as("GET", `/admin/features/${KT}/entitlements?q=ZET`);
    expect(q.json.items.map((e: Json) => e.tenant_key)).toEqual(["zeta"]);
    const page = await as("GET", `/admin/features/${KT}/entitlements?limit=1&offset=1`);
    expect(page.json.items.map((e: Json) => e.tenant_key)).toEqual(["zeta"]);
    expect(page.json.total).toBe(2);
    expectErr(await as("GET", `/admin/features/${KT}/entitlements?limit=201`), "VALIDATION_ERROR");
  });

  it("ADM-FR-31 · M2-AC05 · DELETE → 204 và hàng CÒN trong DB với revoked_at ≠ null; list không còn; DELETE lần 2 không ghi (revoked_at giữ nguyên)", async () => {
    expect(
      (await as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.acme}`)).status,
    ).toBe(204);
    const [row] = await ent(KT, TENANT_ID.acme);
    expect(row?.revoked_at).not.toBeNull();
    const list = await as("GET", `/admin/features/${KT}/entitlements`);
    expect(list.json.items).toEqual([]);
    const first = row?.revoked_at as Date;
    expect(
      (await as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.acme}`)).status,
    ).toBe(204);
    expect(((await ent(KT, TENANT_ID.acme))[0] as Json).revoked_at).toEqual(first);
  });

  it("ADM-FR-31 · M2-AC05 · DELETE khi chưa từng cấp / đã thu hồi sẵn (globex) → 204 không ghi", async () => {
    const [before] = await ent(KT, TENANT_ID.globex);
    expect(
      (await as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.globex}`)).status,
    ).toBe(204);
    expect(((await ent(KT, TENANT_ID.globex))[0] as Json).revoked_at).toEqual(before?.revoked_at);
    expect(
      (await as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`)).status,
    ).toBe(204);
    expect((await ent(KT, TENANT_ID.zeta)).length).toBe(0);
  });

  it("ADM-FR-31 · M2-AC05 · thu hồi rồi cấp lại → CÙNG hàng (đúng 1 hàng), revoked_at null, granted_at mới, granted_by mới", async () => {
    const [old] = await ent(KT, TENANT_ID.globex);
    expect(old?.revoked_at).not.toBeNull();
    const res = await as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.globex}`);
    expect(res.status).toBe(200);
    const rows = await ent(KT, TENANT_ID.globex);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).toBeNull();
    expect(new Date(rows[0]?.granted_at).getTime()).toBeGreaterThan(
      new Date(old?.granted_at).getTime(),
    );
    const [admin] = await env.owner`select id from admin.users where username = 'admin'`;
    expect(rows[0]?.granted_by).toBe(admin?.id);
  });

  it("ADM-FR-31 · M2-R22 · feature lạ / tenant lạ → 404 (feature lạ ưu tiên, body y hệt); entitlement KHÔNG tăng version feature", async () => {
    const a = await as("PUT", `/admin/features/${ID.unknown}/entitlements/${ID.unknown}`);
    const b = await as("PUT", `/admin/features/${ID.unknown}/entitlements/${TENANT_ID.acme}`);
    expectErr(a, "NOT_FOUND");
    expect(a.text).toBe(b.text);
    expectErr(await as("PUT", `/admin/features/${KT}/entitlements/${ID.unknown}`), "NOT_FOUND");
    expectErr(await as("DELETE", `/admin/features/${KT}/entitlements/${ID.unknown}`), "NOT_FOUND");
    const v = await featVersion(KT);
    await as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`);
    await as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.acme}`);
    expect(await featVersion(KT)).toBe(v);
  });

  it("ADM-BR-10 · M2-R22 · core: PUT/DELETE entitlement → 409 CORE_FEATURE_PROTECTED; GET entitlements của core → {items:[], total:0}", async () => {
    const core = await env.coreId();
    expectErr(
      await as("PUT", `/admin/features/${core}/entitlements/${TENANT_ID.acme}`),
      "CORE_FEATURE_PROTECTED",
    );
    expectErr(
      await as("DELETE", `/admin/features/${core}/entitlements/${TENANT_ID.acme}`),
      "CORE_FEATURE_PROTECTED",
    );
    const list = await as("GET", `/admin/features/${core}/entitlements`);
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ items: [], total: 0 });
    expect(
      (await env.owner`select 1 from admin.feature_entitlements where feature_id = ${core}`).length,
    ).toBe(0);
  });

  it("ADM-FR-31 · M2-R22 · tenant_count trong list tăng/giảm theo cấp/thu hồi; thu hồi giữ hàng (BR-12)", async () => {
    const count = async () =>
      (
        (await as("GET", "/admin/features")).json.items.find(
          (f: Json) => f.key === "ke-toan",
        ) as Json
      ).tenant_count;
    expect(await count()).toBe(1);
    await as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`);
    expect(await count()).toBe(2);
    await as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`);
    expect(await count()).toBe(1);
    expect((await ent(KT, TENANT_ID.zeta)).length).toBe(1);
  });
});

describe("ADM-FR-30 · ngoài phạm vi M2 và đồng thời", () => {
  it("ADM-BR-10 · không có route grant/groups của M3: POST /admin/features/:id/grants → 404", async () => {
    expect((await as("POST", `/admin/features/${KT}/grants`, {})).status).toBe(404);
    expect((await as("GET", "/admin/groups")).status).toBe(404);
  });

  it("ADM-FR-30 · M2-R25 · 15 PATCH song song cùng version → đúng 1×200 và 14×409 VERSION_CONFLICT", async () => {
    const rs = await Promise.all(
      Array.from({ length: 15 }, (_, i) => patch(KT, 1, { name: { vi: `Kế toán ${i}` } })),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const lose = rs.filter((r) => r.status === 409);
    expect(lose).toHaveLength(14);
    expect(lose.every((r) => r.json.error.code === "VERSION_CONFLICT")).toBe(true);
    expect(await featVersion(KT)).toBe(2);
  });

  it("ADM-FR-31 · M2-R22 · PUT entitlement song song ×10 → tất cả 200, đúng 1 hàng; PUT ∥ DELETE cùng cặp → 1 hàng, không 500", async () => {
    const puts = await Promise.all(
      Array.from({ length: 10 }, () =>
        as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.zeta}`),
      ),
    );
    expect(puts.every((r) => r.status === 200)).toBe(true);
    expect((await ent(KT, TENANT_ID.zeta)).length).toBe(1);
    for (let i = 0; i < 5; i++) {
      const [p, d] = await Promise.all([
        as("PUT", `/admin/features/${KT}/entitlements/${TENANT_ID.globex}`),
        as("DELETE", `/admin/features/${KT}/entitlements/${TENANT_ID.globex}`),
      ]);
      expect([p.status, d.status]).toEqual([200, 204]);
      expect((await ent(KT, TENANT_ID.globex)).length).toBe(1);
    }
  });
});
