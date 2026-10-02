// ADM-FR-32, ADM-FR-35 · PUT /admin/grants/batch: một transaction, ≤ 200 thao tác, toàn phần hoặc không có gì
// (M3-AC03; M3-R08; test-plan I-GB). Kiểm hiệu lực bằng SQL tham chiếu `hub_ro`. Mỗi `it` tự dựng lại dữ liệu.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { GrantBatchResponseSchema } from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  hubVisible,
  ID,
  ID3,
  id3,
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
const KD = ID3.group.acmeKinhDoanh;
const P = (feature_id: string, group_id: string) => ({ feature_id, group_id });
const batch = (call: typeof admin, body: unknown, qs = "") =>
  call("PUT", `/admin/grants/batch${qs}`, body);
const batchOk = async (call: typeof admin, body: unknown, qs = "") => {
  const res = await batch(call, body, qs);
  expect(res.status).toBe(200);
  return GrantBatchResponseSchema.parse(res.json);
};
const nGrants = () => num(env.owner, "select count(*)::int as n from admin.feature_grants");
const groupGrantSet = async () =>
  (
    await env.owner<
      { k: string }[]
    >`select feature_id || ':' || group_id as k from admin.feature_grants
      where group_id is not null order by 1`
  ).map((r) => r.k);

describe("ADM-FR-35 · batch hợp lệ (M3-R08)", () => {
  it("ADM-FR-35 · M3-R08 · add 3 cặp + remove 1 cặp → {added:3, removed:1, unchanged:0}; DB đúng (6 grant)", async () => {
    const r = await batchOk(binh, {
      add: [P(F.dichThuat, KT), P(F.dichThuat, KD), P(F.thuNghiem, KD)],
      remove: [P(F.keToan, KT)],
    });
    expect(r).toEqual({ added: 3, removed: 1, unchanged: 0 });
    expect(await nGrants()).toBe(6);
    const set = await groupGrantSet();
    expect(set).toContain(`${F.dichThuat}:${KT}`);
    expect(set).not.toContain(`${F.keToan}:${KT}`);
  });

  it("ADM-FR-35 · M3-R08 · áp lại cùng batch → {0, 0, 4}; số hàng và config_version KHÔNG đổi", async () => {
    const body = {
      add: [P(F.dichThuat, KT), P(F.dichThuat, KD), P(F.thuNghiem, KD)],
      remove: [P(F.keToan, KT)],
    };
    await batchOk(binh, body);
    const [n, v] = [await nGrants(), await env.cfg()];
    expect(await batchOk(binh, body)).toEqual({ added: 0, removed: 0, unchanged: 4 });
    expect([await nGrants(), await env.cfg()]).toEqual([n, v]);
  });

  it("ADM-FR-35 · M3-R08 · thêm cặp đã có + bớt cặp không có đếm vào unchanged: {added:1, removed:0, unchanged:2}", async () => {
    const beta = await betaId(env.owner, "acme");
    const r = await batchOk(binh, {
      add: [P(F.baoCao, beta), P(F.dichThuat, KD)],
      remove: [P(F.keToan, KD)],
    });
    expect(r).toEqual({ added: 1, removed: 0, unchanged: 2 });
  });

  it("ADM-FR-35 · M3-R08 · chỉ remove (không add) và chỉ add (không remove) đều hợp lệ", async () => {
    expect(await batchOk(binh, { remove: [P(F.keToan, KT)] })).toEqual({
      added: 0,
      removed: 1,
      unchanged: 0,
    });
    expect(await batchOk(binh, { add: [P(F.keToan, KT)] })).toEqual({
      added: 1,
      removed: 0,
      unchanged: 0,
    });
  });

  it("ADM-FR-35 · M3-R08 · remove được grant của feature ĐÃ THU HỒI entitlement (platform, globex ke-toan) và của feature chưa entitlement", async () => {
    const r = await batchOk(
      admin,
      { remove: [P(F.keToan, ID3.group.globexKeToan)] },
      `?tenant_id=${TENANT_ID.globex}`,
    );
    expect(r).toEqual({ added: 0, removed: 1, unchanged: 0 });
    await env.owner`update admin.feature_entitlements set revoked_at = now() where feature_id = ${F.dichThuat} and tenant_id = ${TENANT_ID.acme}`;
    expect(await batchOk(binh, { remove: [P(F.dichThuat, KT)] })).toEqual({
      added: 0,
      removed: 0,
      unchanged: 1,
    });
  });

  it("ADM-FR-35 · M3-R08 · hoán vị thứ tự add/remove cho CÙNG kết quả cuối và cùng đếm", async () => {
    const adds = [P(F.dichThuat, KT), P(F.thuNghiem, KD), P(F.dichThuat, KD)];
    const removes = async () => [P(F.keToan, KT), P(F.baoCao, await betaId(env.owner, "acme"))];
    const remove = await removes();
    const a = await batchOk(binh, { add: adds, remove });
    const setA = await groupGrantSet();
    await env.reset3();
    const b = await batchOk(binh, {
      add: [...adds].reverse(),
      remove: [...(await removes())].reverse(),
    });
    expect(b).toEqual(a);
    expect(await groupGrantSet()).toEqual(setA);
  });

  it("ADM-FR-35 · M3-R08 · hiệu lực phản ánh ngay: sau batch, SQL hub_ro cho thành viên KD thấy /kiemtra-hoadon (không có hàng 'đã tính sẵn')", async () => {
    await env.owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${TENANT_ID.acme}, ${KD}, ${USER_ID.an})`;
    expect(await hubVisible(env.owner, USER_ID.an)).not.toContain("kiemtra-hoadon");
    await batchOk(binh, { add: [P(F.keToan, KD)] });
    expect(await hubVisible(env.owner, USER_ID.an)).toContain("kiemtra-hoadon");
  });

  it("ADM-FR-35 · M3-R08 · grants ghi đúng tenant_id (acme) và đúng granted_by 'binh'", async () => {
    await batchOk(binh, { add: [P(F.dichThuat, KD)] });
    const [row] = await env.owner<{ tenant_id: string; by: string | null }[]>`select g.tenant_id,
      u.username as by from admin.feature_grants g left join admin.users u on u.id = g.granted_by
      where g.feature_id = ${F.dichThuat} and g.group_id = ${KD}`;
    expect([row?.tenant_id, row?.by]).toEqual([TENANT_ID.acme, "binh"]);
  });
});

describe("ADM-FR-35 · toàn phần hoặc không có gì (M3-R08)", () => {
  /** 3 phần tử hợp lệ + phần tử hỏng ở CUỐI; DB và config_version không đổi. */
  async function rejected(
    bad: { add?: unknown[]; remove?: unknown[] },
    code: Parameters<typeof expectErr>[1],
  ) {
    const good = {
      add: [P(F.dichThuat, KT), P(F.thuNghiem, KD), P(F.dichThuat, KD)],
      remove: [P(F.keToan, KT)],
    };
    const [n, set, v] = [await nGrants(), await groupGrantSet(), await env.cfg()];
    const res = await batch(binh, {
      add: [...good.add, ...(bad.add ?? [])],
      remove: [...good.remove, ...(bad.remove ?? [])],
    });
    expectErr(res, code);
    expect([await nGrants(), await groupGrantSet(), await env.cfg()]).toEqual([n, set, v]);
    return res;
  }

  it("ADM-FR-35 · M3-R08 · feature lạ → 400 INVALID_REFERENCE {field:'feature_ids', ids sắp tăng, không trùng}; không ghi gì", async () => {
    const res = await rejected(
      { add: [P(id3(98), KT), P(ID3.unknown, KD), P(id3(98), KD)] },
      "INVALID_REFERENCE",
    );
    expect(res.json.error.details).toEqual({ field: "feature_ids", ids: [id3(98), ID3.unknown] });
  });

  it("ADM-FR-35 · M3-R08 · group tenant khác → 400 INVALID_REFERENCE {field:'group_ids', ids}; không ghi gì", async () => {
    const res = await rejected({ add: [P(F.keToan, ID3.group.globexKeToan)] }, "INVALID_REFERENCE");
    expect(res.json.error.details).toEqual({ field: "group_ids", ids: [ID3.group.globexKeToan] });
  });

  it("ADM-FR-35 · M3-R08 · core trong add HOẶC trong remove → 409 CORE_FEATURE_PROTECTED; không ghi gì", async () => {
    const core = await env.coreId();
    await rejected({ add: [P(core, KT)] }, "CORE_FEATURE_PROTECTED");
    await rejected({ remove: [P(core, KT)] }, "CORE_FEATURE_PROTECTED");
  });

  it("ADM-FR-35 · M3-R08 · NOT_ENTITLED chỉ xét add: {feature_ids sắp tăng} gồm feature đã thu hồi và feature chưa mở; không ghi gì", async () => {
    await env.owner`update admin.feature_entitlements set revoked_at = now() where feature_id = ${F.dichThuat} and tenant_id = ${TENANT_ID.acme}`;
    const res = await rejected(
      { add: [P(ID3.feature.phapChe, KT), P(F.dichThuat, await betaId(env.owner, "acme"))] },
      "NOT_ENTITLED",
    );
    expect(res.json.error.details).toEqual({ feature_ids: [F.dichThuat, ID3.feature.phapChe] });
  });

  it("ADM-FR-35 · M3-R08 · thứ tự kiểm: feature_ids → group_ids → core → NOT_ENTITLED (loại dần từng lỗi)", async () => {
    const core = await env.coreId();
    const all = [
      P(id3(98), KT),
      P(F.keToan, ID3.group.globexKeToan),
      P(core, KT),
      P(ID3.feature.phapChe, KT),
    ];
    const expectCode = async (
      add: unknown[],
      code: Parameters<typeof expectErr>[1],
      field?: string,
    ) => {
      const res = await batch(binh, { add });
      expectErr(res, code);
      if (field) expect(res.json.error.details.field).toBe(field);
    };
    await expectCode(all, "INVALID_REFERENCE", "feature_ids");
    await expectCode(all.slice(1), "INVALID_REFERENCE", "group_ids");
    await expectCode(all.slice(2), "CORE_FEATURE_PROTECTED");
    await expectCode(all.slice(3), "NOT_ENTITLED");
    expect(await nGrants()).toBe(4);
  });
});

describe("ADM-FR-35 · giới hạn 200 và dữ liệu sai (M3-R08)", () => {
  it("ADM-FR-35 · M3-R08 · đúng 200 thao tác (200 group × 1 feature) → 200 {added:200}", async () => {
    const rows = Array.from({ length: 199 }, (_, i) => `gr${String(i).padStart(3, "0")}`);
    await env.owner`insert into admin.groups (tenant_id, key, name)
      select ${TENANT_ID.acme}, k, '{"vi":"x"}'::jsonb from unnest(${rows}::text[]) as k`;
    const ids = (
      await env.owner<
        { id: string }[]
      >`select id from admin.groups where tenant_id = ${TENANT_ID.acme}
        and key like 'gr%' order by key`
    ).map((r) => r.id);
    const add = [...ids, KD].map((g) => P(F.thuNghiem, g));
    expect(add).toHaveLength(200);
    expect(await batchOk(binh, { add })).toEqual({ added: 200, removed: 0, unchanged: 0 });
    expect(await nGrants()).toBe(204);
  });

  it("ADM-FR-35 · M3-R08 · 100 add + 100 remove (remove không tồn tại) → 200, unchanged 100", async () => {
    const groups = Array.from({ length: 100 }, (_, i) => `rm${String(i).padStart(3, "0")}`);
    await env.owner`insert into admin.groups (tenant_id, key, name)
      select ${TENANT_ID.acme}, k, '{"vi":"x"}'::jsonb from unnest(${groups}::text[]) as k`;
    const gids = (
      await env.owner<
        { id: string }[]
      >`select id from admin.groups where key like 'rm%' order by key`
    ).map((r) => r.id);
    const r = await batchOk(binh, {
      add: [KT, KD].flatMap((g) => [P(F.dichThuat, g), P(F.thuNghiem, g)]),
      remove: gids.map((g) => P(F.baoCao, g)),
    });
    expect(r).toEqual({ added: 4, removed: 0, unchanged: 100 });
  });

  it("ADM-FR-35 · M3-R08 · 201 thao tác → 400 VALIDATION_ERROR; 0 thao tác và {} → 400; không ghi", async () => {
    const over = Array.from({ length: 201 }, (_, i) =>
      P(`01900000-0000-7000-8000-${String(1000 + i).padStart(12, "0")}`, KT),
    );
    expectErr(await batch(binh, { add: over }), "VALIDATION_ERROR");
    expectErr(await batch(binh, { add: [] }), "VALIDATION_ERROR");
    expectErr(await batch(binh, {}), "VALIDATION_ERROR");
    expect(await nGrants()).toBe(4);
  });

  it("ADM-FR-35 · M3-R08 · cặp trùng trong add → 400; cặp ở cả add và remove → 400; phần tử có user_id → 400; khoá lạ → 400", async () => {
    const a = P(F.dichThuat, KT);
    expectErr(await batch(binh, { add: [a, P(F.thuNghiem, KD), a] }), "VALIDATION_ERROR");
    expectErr(await batch(binh, { add: [a], remove: [a] }), "VALIDATION_ERROR");
    expectErr(await batch(binh, { add: [{ ...a, user_id: USER_ID.lan }] }), "VALIDATION_ERROR");
    expectErr(await batch(binh, { add: [a], extra: 1 }), "VALIDATION_ERROR");
    expect(await nGrants()).toBe(4);
  });

  it("ADM-BR-09 · M3-R06 · platform thiếu tenant_id → 400 TENANT_REQUIRED; tenant lạ → 404; member → 403 (body sai vẫn 403); không token → 401", async () => {
    const body = { add: [P(F.dichThuat, KT)] };
    expectErr(await batch(admin, body), "TENANT_REQUIRED");
    expectErr(await batch(admin, body, `?tenant_id=${ID3.unknown}`), "NOT_FOUND");
    expectErr(await batch(lan, { sai: 1 }), "FORBIDDEN");
    expectErr(await env.call("PUT", "/admin/grants/batch", { body }), "UNAUTHORIZED");
  });

  it("ADM-BR-09 · M3-R06 · tenant_admin globex gửi group acme → 400 INVALID_REFERENCE group_ids (không rò, không ghi)", async () => {
    const res = await batch(hoa, { add: [P(F.keToan, KT)] });
    expectErr(res, "INVALID_REFERENCE");
    expect(res.json.error.details.field).toBe("group_ids");
    expect(await nGrants()).toBe(4);
  });
});
