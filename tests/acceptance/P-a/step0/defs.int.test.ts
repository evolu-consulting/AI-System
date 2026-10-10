// ADM-FR-65 · ADM-FR-66 · ADM-FR-67 · HUB-FR-104 · HUB-FR-114 · S0-20…S0-31 (test-plan-int §1, plan-contract §6): hub-admin
// `process-defs` CRUD + chép mẫu + kiểm định nghĩa + version + audit + `GET /agent-teams` + run từ admin. Mẫu `sdlc`/`hoa-don`
// chèn bằng fixture SQL (không phụ thuộc seed — seed kiểm ở `seed.int`). Chỉ chèn khi `ready`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AGB,
  type CtxPa,
  defInput,
  fixId,
  insertDef,
  type Json,
  PA,
  PA_FIX,
  type Res,
  type Role,
  stageDef,
  startPa,
  T,
} from "../_support/pa";
import { needSchema } from "../_support/schema";

let c: CtxPa;
const TPL_SDLC = fixId();
const TPL_HD = fixId();
const TEAM = { ok: fixId(), revoked: fixId(), beta: fixId() };
const review = (g: string | null) => ({ kind: "review", group_id: g });
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await insertDef(c.sql, {
    id: TPL_SDLC,
    tenantId: null,
    input: defInput({ key: "sdlc", name: "SDLC", groupId: PA_FIX.gKeToan }),
  });
  await insertDef(c.sql, {
    id: TPL_HD,
    tenantId: null,
    input: defInput({ key: "hoa-don", name: "Hoá đơn" }),
  });
  await c.sql`update hub.process_defs set enabled = false where id in (${TPL_SDLC}, ${TPL_HD})`;
  await insertDef(c.sql, {
    id: PA_FIX.defHoaDon,
    tenantId: T.acme,
    input: defInput({ groupId: PA_FIX.gKeToan }),
  });
  await insertDef(c.sql, {
    id: PA_FIX.defBeta,
    tenantId: T.beta,
    input: defInput({ key: "beta-only" }),
  });
  for (const [id, key] of Object.entries(TEAM).map(([k, v]) => [v, `team-${k}`] as const))
    await c.sql`insert into hub.agent_teams (id, key, name) values (${id}, ${key}, ${c.sql.json({ vi: key, en: key })})`;
  await c.sql`insert into hub.agent_team_members (team_id, agent_id, role, sections, position) values
    (${TEAM.ok}, ${AGB.trello}, 'Phân tích', '{"Phần B"}'::text[], 1),
    (${TEAM.ok}, ${AGB.hoadon}, 'Trưởng nhóm', '{"Phần A"}'::text[], 0)`;
  await c.sql`insert into hub.agent_team_entitlements (team_id, tenant_id, revoked_at) values
    (${TEAM.ok}, ${T.acme}, null), (${TEAM.revoked}, ${T.acme}, now()), (${TEAM.beta}, ${T.beta}, null)`;
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const code = (r: Res) => ({ s: r.status, code: r.json?.error?.code });
const get = (who: Role, id: string) => c.call(who, "GET", `/process-defs/${id}`);
async function current(who: Role, id: string): Promise<Json> {
  const r = await get(who, id);
  expect(r.status).toBe(200);
  return r.json;
}
const put = (who: Role, id: string, body: Json) => c.call(who, "PUT", `/process-defs/${id}`, body);
const asInput = (d: Json): Json => {
  const { key, name, description, input_hint, run_group_ids, stages, token_budget, enabled } = d;
  return { key, name, description, input_hint, run_group_ids, stages, token_budget, enabled };
};

describe("S0-20…S0-24 · danh sách + chép mẫu + quyền [ADM-FR-65]", () => {
  it("ADM-FR-65 · S0-20 · tadmin thấy mẫu sdlc/hoa-don + quy trình acme, không thấy beta; member ⇒ 403", async () => {
    needSchema(c.ready);
    const r = await c.call("Adm", "GET", "/process-defs");
    expect(r.status).toBe(200);
    const items: Json[] = r.json?.items ?? [];
    expect(
      items
        .filter((x) => x.is_template)
        .map((x) => x.key)
        .sort(),
    ).toEqual(["hoa-don", "sdlc"]);
    expect(items.map((x) => x.id)).toContain(PA_FIX.defHoaDon);
    expect(items.map((x) => x.id)).not.toContain(PA_FIX.defBeta);
    expect((await c.call("A", "GET", "/process-defs")).status).toBe(403);
  });
  it("ADM-FR-65 · S0-21 · chép sdlc ⇒ 201 enabled=false, group review null, source_template_id; lần 2 ⇒ 409; key sdlc-2 ⇒ 201", async () => {
    needSchema(c.ready);
    const r = await c.call("Adm", "POST", `/process-defs/${TPL_SDLC}/copy`, {});
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      key: "sdlc",
      enabled: false,
      source_template_id: TPL_SDLC,
      tenant_id: T.acme,
    });
    for (const s of r.json?.stages ?? [])
      if (s.after.kind === "review") expect(s.after.group_id).toBeNull();
    expect(code(await c.call("Adm", "POST", `/process-defs/${TPL_SDLC}/copy`, {}))).toEqual({
      s: 409,
      code: "PROCESS_KEY_TAKEN",
    });
    expect(
      (await c.call("Adm", "POST", `/process-defs/${TPL_SDLC}/copy`, { key: "sdlc-2" })).status,
    ).toBe(201);
  });
  it("ADM-FR-65 · S0-22 · platform_admin POST không tenant_id ⇒ mẫu tenant_id null; tadmin PUT mẫu ⇒ 403 TEMPLATE_READ_ONLY", async () => {
    needSchema(c.ready);
    const r = await c.call(
      "P",
      "POST",
      "/process-defs",
      defInput({ key: "mau-moi", enabled: false }),
    );
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ tenant_id: null, is_template: true });
    const body = { ...defInput({ key: "sdlc", name: "SDLC sửa", enabled: false }), version: 1 };
    expect(code(await put("Adm", TPL_SDLC, body))).toEqual({ s: 403, code: "TEMPLATE_READ_ONLY" });
  });
  it("ADM-FR-65 · S0-23 · platform_admin GET không tenant_id ⇒ chỉ mẫu hoặc 400 TENANT_REQUIRED", async () => {
    needSchema(c.ready);
    const r = await c.call("P", "GET", "/process-defs");
    if (r.status === 400) expect(r.json?.error?.code).toBe("TENANT_REQUIRED");
    else {
      expect(r.status).toBe(200);
      expect((r.json?.items ?? []).every((x: Json) => x.is_template === true)).toBe(true);
    }
  });
  it("HUB-BR-25 · S0-24 · tadmin_beta GET/PUT quy trình acme ⇒ 404", async () => {
    needSchema(c.ready);
    expect((await get("Db", PA_FIX.defHoaDon)).status).toBe(404);
    expect((await put("Db", PA_FIX.defHoaDon, { ...defInput(), version: 1 })).status).toBe(404);
  });
});

describe("S0-25…S0-29 · kiểm định nghĩa + version + audit [ADM-FR-66]", () => {
  it("ADM-FR-66 · S0-25 · bật khi stage review group_id null ⇒ 422 PROCESS_DEF_INCOMPLETE paths", async () => {
    needSchema(c.ready);
    const d = await current("Adm", PA_FIX.defHoaDon);
    const body = { ...asInput(d), enabled: true, version: d.version };
    body.stages[0].after = review(null);
    const r = await put("Adm", PA_FIX.defHoaDon, body);
    expect(code(r)).toEqual({ s: 422, code: "PROCESS_DEF_INCOMPLETE" });
    expect(r.json?.error?.details?.paths).toEqual(["stages.0.after.group_id"]);
  });
  it("HUB-FR-109 · S0-26 · real_action ở stage 0 / stage trước auto ⇒ 422 PROCESS_DEF_INVALID{paths}", async () => {
    needSchema(c.ready);
    for (const stages of [
      [stageDef({ key: "a", real_action: true, after: review(PA_FIX.gKeToan) })],
      [
        stageDef({ key: "a", after: { kind: "auto" } }),
        stageDef({ key: "b", real_action: true, after: { kind: "auto" } }),
      ],
    ]) {
      const r = await c.call(
        "Adm",
        "POST",
        "/process-defs",
        defInput({ key: `p-${fixId().slice(-4)}`, stages }),
      );
      expect(code(r)).toEqual({ s: 422, code: "PROCESS_DEF_INVALID" });
      expect((r.json?.error?.details?.paths ?? []).length).toBeGreaterThan(0);
    }
  });
  it("ADM-FR-65 · S0-27 · agent/team chưa bật, group/user tenant khác ⇒ 422 PROCESS_REF_INVALID{path, ref}", async () => {
    needSchema(c.ready);
    const [bg] = await c.sql<
      Json[]
    >`select id from admin.groups where tenant_id = ${T.beta} limit 1`;
    const cases: [Json, string][] = [
      [
        stageDef({
          key: "a",
          executor: { kind: "agent", agent_id: fixId() },
          after: review(PA_FIX.gKeToan),
        }),
        "agent",
      ],
      [
        stageDef({
          key: "a",
          executor: { kind: "team", team_id: TEAM.revoked },
          after: review(PA_FIX.gKeToan),
        }),
        "team",
      ],
      [stageDef({ key: "a", after: review(bg?.id) }), "group"],
      [
        stageDef({
          key: "a",
          after: review(PA_FIX.gKeToan),
          answerer: { kind: "user", user_id: PA.D.id },
        }),
        "user",
      ],
    ];
    for (const [s, ref] of cases) {
      const r = await c.call(
        "Adm",
        "POST",
        "/process-defs",
        defInput({ key: `r-${ref}`, stages: [s], enabled: false }),
      );
      expect({ ...code(r), ref: r.json?.error?.details?.ref }).toEqual({
        s: 422,
        code: "PROCESS_REF_INVALID",
        ref,
      });
      expect(String(r.json?.error?.details?.path ?? "")).toMatch(/^stages\.0/);
    }
  });
  it("ADM-FR-65 · S0-28 · PUT / DELETE version cũ ⇒ 409 VERSION_CONFLICT", async () => {
    needSchema(c.ready);
    const d = await current("Adm", PA_FIX.defHoaDon);
    const ok = await put("Adm", PA_FIX.defHoaDon, {
      ...asInput(d),
      name: "Hoá đơn v2",
      version: d.version,
    });
    expect(ok.status).toBe(200);
    expect(code(await put("Adm", PA_FIX.defHoaDon, { ...asInput(d), version: d.version }))).toEqual(
      { s: 409, code: "VERSION_CONFLICT" },
    );
    expect(
      code(await c.call("Adm", "DELETE", `/process-defs/${PA_FIX.defHoaDon}?version=${d.version}`)),
    ).toEqual({
      s: 409,
      code: "VERSION_CONFLICT",
    });
  });
  it("ADM-FR-65 · S0-29 · tạo/sửa/chép/xoá ⇒ mỗi lần 1 audit; version+1; xoá mềm ⇒ GET 404", async () => {
    needSchema(c.ready);
    const audits = async (action: string) =>
      Number(
        (
          await c.sql`select count(*)::int as n from hub.audit_log where entity = 'process_def' and action = ${action}`
        )[0]?.n,
      );
    const before = {
      create: await audits("create"),
      update: await audits("update"),
      copy: await audits("copy"),
      delete: await audits("delete"),
    };
    const cr = await c.call(
      "Adm",
      "POST",
      "/process-defs",
      defInput({ key: "p-audit", enabled: false }),
    );
    expect(cr.status).toBe(201);
    const up = await put("Adm", cr.json.id, {
      ...asInput(cr.json),
      name: "Đổi tên",
      version: cr.json.version,
    });
    expect(up.json?.version).toBe(cr.json.version + 1);
    expect(
      (await c.call("Adm", "POST", `/process-defs/${TPL_HD}/copy`, { key: "hd-audit" })).status,
    ).toBe(201);
    expect(
      (await c.call("Adm", "DELETE", `/process-defs/${cr.json.id}?version=${up.json?.version}`))
        .status,
    ).toBe(204);
    expect((await get("Adm", cr.json.id)).status).toBe(404);
    const [row] = await c.sql<
      Json[]
    >`select deleted_at from hub.process_defs where id = ${cr.json.id}`;
    expect(row?.deleted_at).not.toBeNull();
    expect({
      create: await audits("create"),
      update: await audits("update"),
      copy: await audits("copy"),
      delete: await audits("delete"),
    }).toEqual({
      create: before.create + 1,
      update: before.update + 1,
      copy: before.copy + 1,
      delete: before.delete + 1,
    });
  });
});

describe("S0-30…S0-31 · nhóm agent + chạy từ admin [HUB-FR-114, ADM-FR-67]", () => {
  it("HUB-FR-114 · S0-30 · GET /agent-teams: chỉ nhóm bật cho acme chưa revoke, members theo position; member ⇒ 403", async () => {
    needSchema(c.ready);
    const r = await c.call("Adm", "GET", "/agent-teams");
    expect(r.status).toBe(200);
    const items: Json[] = r.json?.items ?? [];
    expect(items.map((x) => x.id)).toEqual([TEAM.ok]);
    expect(items[0]?.members.map((m: Json) => m.agent.id)).toEqual([AGB.hoadon, AGB.trello]);
    expect(items[0]?.members[0]?.sections).toEqual(["Phần A"]);
    expect((await c.call("A", "GET", "/agent-teams")).status).toBe(403);
  });
  it("ADM-FR-67 · S0-31 · platform_admin chạy ⇒ 403 FORBIDDEN; quy trình tắt / mẫu ⇒ 404 PROCESS_NOT_FOUND", async () => {
    needSchema(c.ready);
    const off = fixId();
    await insertDef(c.sql, {
      id: off,
      tenantId: T.acme,
      input: defInput({ key: "p-tat", enabled: false }),
    });
    expect(
      code(
        await c.call("P", "POST", `/process-defs/${PA_FIX.defHoaDon}/run?tenant_id=${T.acme}`, {
          input: "x",
        }),
      ),
    ).toEqual({
      s: 403,
      code: "FORBIDDEN",
    });
    for (const id of [off, TPL_HD])
      expect(code(await c.call("Adm", "POST", `/process-defs/${id}/run`, { input: "x" }))).toEqual({
        s: 404,
        code: "PROCESS_NOT_FOUND",
      });
  });
});
