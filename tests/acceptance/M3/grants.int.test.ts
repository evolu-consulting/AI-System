// ADM-FR-32, ADM-BR-12 · API /admin/grants (M3-AC03; M3-R05, R07, R10; test-plan I-GR).
// Dữ liệu chéo module (entitlement, thành viên) dựng bằng owner SQL; kiểm hiệu lực bằng SQL tham chiếu `hub_ro`
// (không dùng effective-access vì route đó chỉ có từ T6). Mỗi `it` tự dựng lại dữ liệu (beforeEach reset).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { GrantListResponseSchema, GrantSchema } from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  hubVisible,
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

const F = ID.feature;
const KT = ID3.group.acmeKeToan;
const post = (call: typeof admin, body: unknown, qs = "") =>
  call("POST", `/admin/grants${qs}`, body);
const del = (call: typeof admin, qs: string) => call("DELETE", `/admin/grants${qs}`);
const nGrants = () => num(env.owner, "select count(*)::int as n from admin.feature_grants");
const forAcme = `?tenant_id=${TENANT_ID.acme}`;
const forGlobex = `?tenant_id=${TENANT_ID.globex}`;
const list = async (call: typeof admin, qs = "") => {
  const res = await call("GET", `/admin/grants${qs}`);
  expect(res.status).toBe(200);
  return GrantListResponseSchema.parse(res.json);
};

describe("ADM-FR-32 · cấp grant (M3-R07)", () => {
  it("ADM-FR-32 · M3-R07 · tenant_admin POST group → 201 GrantSchema (subject group ke-toan, entitled true, granted_by 'binh', tenant acme, feature dich-thuat)", async () => {
    const res = await post(binh, { feature_id: F.dichThuat, group_id: KT });
    expect(res.status).toBe(201);
    const g = GrantSchema.parse(res.json);
    expect(g).toMatchObject({ tenant_id: TENANT_ID.acme, entitled: true, granted_by: "binh" });
    expect(g.feature.key).toBe("dich-thuat");
    expect(g.subject.type === "group" && g.subject.group.key).toBe("ke-toan");
    expect(await nGrants()).toBe(5);
  });

  it("ADM-FR-32 · M3-R07 · cấp trùng → 200 cùng id, không ghi (số hàng, config_version không đổi)", async () => {
    const first = GrantSchema.parse(
      (await post(binh, { feature_id: F.dichThuat, group_id: KT })).json,
    );
    const v = await env.cfg();
    const again = await post(binh, { feature_id: F.dichThuat, group_id: KT });
    expect(again.status).toBe(200);
    expect(GrantSchema.parse(again.json).id).toBe(first.id);
    expect(await nGrants()).toBe(5);
    expect(await env.cfg()).toBe(v);
  });

  it("ADM-FR-32 · M3-R07 · subject user (lan) → 201 subject.type 'user' username lan; cấp trùng cho user → 200", async () => {
    const res = await post(binh, { feature_id: F.thuNghiem, user_id: USER_ID.lan });
    expect(res.status).toBe(201);
    const g = GrantSchema.parse(res.json);
    expect(g.subject.type === "user" && g.subject.user.username).toBe("lan");
    expect((await post(binh, { feature_id: F.thuNghiem, user_id: USER_ID.lan })).status).toBe(200);
  });

  it("ADM-FR-32 · M3-R07 · INVALID_REFERENCE luôn có ids: feature lạ → {feature_id,[id]}; group tenant khác → {group_id,[id]} (body → 400, không 404); user tenant khác → {user_id,[id]}", async () => {
    const e1 = await post(binh, { feature_id: ID3.unknown, group_id: KT });
    expectErr(e1, "INVALID_REFERENCE");
    expect(e1.json.error.details).toEqual({ field: "feature_id", ids: [ID3.unknown] });
    const e2 = await post(binh, { feature_id: F.keToan, group_id: ID3.group.globexKeToan });
    expectErr(e2, "INVALID_REFERENCE");
    expect(e2.json.error.details).toEqual({ field: "group_id", ids: [ID3.group.globexKeToan] });
    const e3 = await post(binh, { feature_id: F.keToan, user_id: USER_ID.khang });
    expectErr(e3, "INVALID_REFERENCE");
    expect(e3.json.error.details).toEqual({ field: "user_id", ids: [USER_ID.khang] });
    const e4 = await post(
      admin,
      { feature_id: F.keToan, group_id: ID3.group.globexKeToan },
      forAcme,
    );
    expectErr(e4, "INVALID_REFERENCE");
  });

  it("ADM-FR-32 · M3-R07 · thứ tự kiểm: feature lạ + group lạ → báo feature_id trước", async () => {
    const res = await post(binh, { feature_id: ID3.unknown, group_id: ID3.group.globexKeToan });
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details.field).toBe("feature_id");
  });

  it("ADM-FR-32 · M3-R07 · feature core (platform và tenant_admin) → 409 CORE_FEATURE_PROTECTED, ưu tiên trước NOT_ENTITLED (core không có entitlement)", async () => {
    const core = await env.coreId();
    expectErr(await post(binh, { feature_id: core, group_id: KT }), "CORE_FEATURE_PROTECTED");
    expectErr(
      await post(admin, { feature_id: core, group_id: KT }, forAcme),
      "CORE_FEATURE_PROTECTED",
    );
    expect(await nGrants()).toBe(4);
  });

  it("ADM-FR-32 · M3-AC03 · feature chưa entitlement (phap-che) → 409 NOT_ENTITLED {feature_ids:[phap-che]}, message tĩnh; không ghi", async () => {
    const res = await post(binh, { feature_id: ID3.feature.phapChe, group_id: KT });
    expectErr(res, "NOT_ENTITLED");
    expect(res.json.error.details).toEqual({ feature_ids: [ID3.feature.phapChe] });
    expect(res.json.error.message).toBe("Feature is not entitled for this tenant");
    expect(await nGrants()).toBe(4);
  });

  it("ADM-FR-32 · M3-R07 · entitlement ĐÃ THU HỒI (globex ke-toan) → NOT_ENTITLED cả với platform_admin", async () => {
    const betaGlobex = await betaId(env.owner, "globex");
    const res = await post(admin, { feature_id: F.keToan, group_id: betaGlobex }, forGlobex);
    expectErr(res, "NOT_ENTITLED");
    expect(res.json.error.details).toEqual({ feature_ids: [F.keToan] });
  });

  it("ADM-FR-32 · M3-R07 · feature off đã entitlement (thu-nghiem) vẫn cấp được → 201", async () => {
    expect((await post(binh, { feature_id: F.thuNghiem, group_id: KT })).status).toBe(201);
  });

  it("ADM-FR-32 · M3-R07 · cả group_id và user_id / không có cái nào / khoá lạ / feature_id không uuid → 400 VALIDATION_ERROR", async () => {
    for (const body of [
      { feature_id: F.keToan, group_id: KT, user_id: USER_ID.lan },
      { feature_id: F.keToan },
      { feature_id: F.keToan, group_id: KT, extra: 1 },
      { feature_id: "abc", group_id: KT },
    ]) {
      expectErr(await post(binh, body), "VALIDATION_ERROR");
    }
  });

  it("ADM-BR-09 · M3-R06 · platform thiếu tenant_id → 400 TENANT_REQUIRED; tenant lạ → 404; member → 403 (body sai vẫn 403); không token → 401", async () => {
    expectErr(await post(admin, { feature_id: F.dichThuat, group_id: KT }), "TENANT_REQUIRED");
    expectErr(
      await post(admin, { feature_id: F.dichThuat, group_id: KT }, `?tenant_id=${ID3.unknown}`),
      "NOT_FOUND",
    );
    expectErr(await post(lan, { sai: 1 }), "FORBIDDEN");
    expectErr(await env.call("POST", "/admin/grants", { body: {} }), "UNAUTHORIZED");
  });

  it("ADM-BR-09 · M3-R06 · tenant_admin globex cấp cho group acme bằng id → 400 INVALID_REFERENCE (không rò, không ghi)", async () => {
    const res = await post(hoa, { feature_id: F.keToan, group_id: KT });
    expectErr(res, "INVALID_REFERENCE");
    expect(await nGrants()).toBe(4);
  });

  it("ADM-FR-55 · M3-R05 · cấp grant không đổi version group/feature/user", async () => {
    const q = (t: string, id: string) =>
      num(env.owner, `select version::int as n from admin.${t} where id = '${id}'`);
    const before = [
      await q("groups", KT),
      await q("features", F.dichThuat),
      await q("users", USER_ID.lan),
    ];
    await post(binh, { feature_id: F.dichThuat, group_id: KT });
    await post(binh, { feature_id: F.dichThuat, user_id: USER_ID.lan });
    expect([
      await q("groups", KT),
      await q("features", F.dichThuat),
      await q("users", USER_ID.lan),
    ]).toEqual(before);
  });
});

describe("ADM-FR-32 · thu grant (M3-R05, R07)", () => {
  it("ADM-FR-32 · M3-R05 · DELETE theo query → 204, hàng mất; thành viên không còn thấy /kiemtra-hoadon theo SQL hub_ro; lần hai → 204", async () => {
    expect(await hubVisible(env.owner, USER_ID.lan)).toContain("kiemtra-hoadon");
    const qs = `?feature_id=${F.keToan}&group_id=${KT}`;
    expect((await del(binh, qs)).status).toBe(204);
    expect(await nGrants()).toBe(3);
    expect(await hubVisible(env.owner, USER_ID.lan)).not.toContain("kiemtra-hoadon");
    expect((await del(binh, qs)).status).toBe(204);
    expect(await nGrants()).toBe(3);
  });

  it("ADM-FR-32 · M3-R07 · DELETE grant của user (an → dich-thuat) → 204, hàng mất", async () => {
    expect((await del(binh, `?feature_id=${F.dichThuat}&user_id=${USER_ID.an}`)).status).toBe(204);
    expect(await nGrants()).toBe(3);
  });

  it("ADM-FR-32 · M3-R07 · DELETE core → 409 CORE_FEATURE_PROTECTED (đồng nhất với POST)", async () => {
    const core = await env.coreId();
    expectErr(await del(binh, `?feature_id=${core}&group_id=${KT}`), "CORE_FEATURE_PROTECTED");
  });

  it("ADM-FR-32 · M3-R07 · feature/group/user lạ → 204; group tenant khác (tenant_admin) → 204 và hàng của tenant kia còn nguyên", async () => {
    expect((await del(binh, `?feature_id=${ID3.unknown}&group_id=${KT}`)).status).toBe(204);
    expect((await del(binh, `?feature_id=${F.keToan}&group_id=${ID3.unknown}`)).status).toBe(204);
    expect((await del(binh, `?feature_id=${F.keToan}&user_id=${ID3.unknown}`)).status).toBe(204);
    expect(
      (await del(binh, `?feature_id=${F.keToan}&group_id=${ID3.group.globexKeToan}`)).status,
    ).toBe(204);
    expect(await nGrants()).toBe(4);
  });

  it("ADM-FR-32 · M3-R07 · thiếu cả group_id/user_id, hoặc có cả hai, hoặc thiếu feature_id → 400; platform thiếu tenant_id → 400 TENANT_REQUIRED", async () => {
    expectErr(await del(binh, `?feature_id=${F.keToan}`), "VALIDATION_ERROR");
    expectErr(
      await del(binh, `?feature_id=${F.keToan}&group_id=${KT}&user_id=${USER_ID.lan}`),
      "VALIDATION_ERROR",
    );
    expectErr(await del(binh, `?group_id=${KT}`), "VALIDATION_ERROR");
    expectErr(await del(admin, `?feature_id=${F.keToan}&group_id=${KT}`), "TENANT_REQUIRED");
    expectErr(await del(lan, `?feature_id=${F.keToan}&group_id=${KT}`), "FORBIDDEN");
  });

  it("ADM-BR-12 · M3-R07 · xoá được grant của feature ĐÃ THU HỒI entitlement (platform, globex ke-toan) → 204", async () => {
    const qs = `?tenant_id=${TENANT_ID.globex}&feature_id=${F.keToan}&group_id=${ID3.group.globexKeToan}`;
    expect((await del(admin, qs)).status).toBe(204);
    expect(await nGrants()).toBe(3);
  });
});

describe("ADM-FR-32 · danh sách grant (M3-R23)", () => {
  it("ADM-FR-32 · M3-R07 · tenant_admin chỉ thấy grant tenant mình, sắp feature.key rồi group trước user: [bao-cao/group beta, dich-thuat/user an, ke-toan/group ke-toan]", async () => {
    const b = await list(binh);
    expect(b.total).toBe(3);
    expect(b.items.map((g) => [g.feature.key, g.subject.type])).toEqual([
      ["bao-cao", "group"],
      ["dich-thuat", "user"],
      ["ke-toan", "group"],
    ]);
    expect(b.items.every((g) => g.tenant_id === TENANT_ID.acme)).toBe(true);
    expect((await list(hoa)).total).toBe(1);
  });

  it("ADM-FR-32 · M3-R07 · platform không tenant_id → cả hai tenant (4 grant), feature.key tăng dần; tenant_id lọc được", async () => {
    const b = await list(admin);
    expect(b.total).toBe(4);
    expect(b.items.map((g) => g.feature.key)).toEqual([
      "bao-cao",
      "dich-thuat",
      "ke-toan",
      "ke-toan",
    ]);
    expect((await list(admin, forGlobex)).total).toBe(1);
  });

  it("ADM-BR-12 · M3-R10 · entitled=false cho grant của entitlement đã thu hồi (globex ke-toan); true cho acme", async () => {
    const b = await list(admin);
    const byTenant = b.items
      .filter((g) => g.feature.key === "ke-toan")
      .map((g) => [g.tenant_id, g.entitled]);
    expect(byTenant).toContainEqual([TENANT_ID.globex, false]);
    expect(byTenant).toContainEqual([TENANT_ID.acme, true]);
  });

  it("ADM-FR-32 · M3-R23 · lọc feature_id, group_id, user_id, q (key/tên feature); limit=201 → 400", async () => {
    expect((await list(binh, `?feature_id=${F.keToan}`)).total).toBe(1);
    expect((await list(binh, `?group_id=${KT}`)).items.map((g) => g.feature.key)).toEqual([
      "ke-toan",
    ]);
    expect((await list(binh, `?user_id=${USER_ID.an}`)).items.map((g) => g.feature.key)).toEqual([
      "dich-thuat",
    ]);
    expect((await list(binh, "?q=ke-")).items.map((g) => g.feature.key)).toEqual(["ke-toan"]);
    expect((await list(binh, "?q=Báo")).items.map((g) => g.feature.key)).toEqual(["bao-cao"]);
    expectErr(await binh("GET", "/admin/grants?limit=201"), "VALIDATION_ERROR");
  });
});

describe("ADM-BR-12 · thu hồi/cấp lại entitlement không đụng grant (M3-R10)", () => {
  it("ADM-BR-12 · M3-R10 · thu hồi entitlement → hàng grant CÒN cùng id, entitled=false; cấp lại → entitled=true, cùng id, không hàng mới", async () => {
    const before = await list(binh, `?feature_id=${F.keToan}`);
    const id = before.items[0]?.id;
    const url = `/admin/features/${F.keToan}/entitlements/${TENANT_ID.acme}`;
    expect((await admin("DELETE", url)).status).toBe(204);
    const revoked = await list(binh, `?feature_id=${F.keToan}`);
    expect([revoked.items[0]?.id, revoked.items[0]?.entitled]).toEqual([id, false]);
    expect((await admin("PUT", url)).status).toBe(200);
    const back = await list(binh, `?feature_id=${F.keToan}`);
    expect([back.items[0]?.id, back.items[0]?.entitled, back.total]).toEqual([id, true, 1]);
    expect(back.items[0]?.granted_at).toBe(before.items[0]?.granted_at as string);
    expect(await nGrants()).toBe(4);
  });

  it("ADM-BR-12 · M3-R10 · xoá feature (M2) → grant của nó mất (cascade)", async () => {
    await env.owner`insert into admin.feature_entitlements (feature_id, tenant_id) values (${ID3.feature.phapChe}, ${TENANT_ID.acme})`;
    expect((await post(binh, { feature_id: ID3.feature.phapChe, group_id: KT })).status).toBe(201);
    expect(await nGrants()).toBe(5);
    expect((await admin("DELETE", `/admin/features/${ID3.feature.phapChe}`)).status).toBe(204);
    expect(await nGrants()).toBe(4);
  });
});
