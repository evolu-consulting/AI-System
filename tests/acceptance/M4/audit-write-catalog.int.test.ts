// ADM-FR-51 · M4-R10 · Q6 · ghi audit (tiếp audit-write): catalog, secret, no-op, rollback, auth, lỗi (test-plan AW6–AW12;
// M4-AC04). Tách file vì trần 400 dòng. Xanh ở T1–T1c.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type AuditHelpers,
  auditHelpers,
  auditMark,
  audits,
  createM4Env,
  ID,
  ID3,
  ID4,
  LEAK_1,
  LEAK_2,
  type Listener,
  type M4Env,
  PW,
  type Res,
  resetNow,
  TENANT_ID,
  track,
  verOf,
  type Who,
} from "./_ab";

let env: M4Env;
let lis: Listener;
const A = TENANT_ID.acme;
const KT = ID3.group.acmeKeToan;
const F = ID.feature;
const W = ID.workflow;
const CMD = ID.command;

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const ADMIN: Who = { tenant: "platform", user: "admin" };
const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const binh = (m: string, p: string, b?: unknown) => env.by("acme", "binh")(m, p, b);
const one: AuditHelpers["one"] = (...a) => auditHelpers(env, lis).one(...a);
const ver = (t: string, id: string) => verOf(env, t, id);
const NULL_T = { tenant_id: null, snapshot: true };
/** Thao tác không được ghi audit: 0 dòng sau sentinel. */
async function none(run: () => Promise<Res>, status: number | "2xx"): Promise<void> {
  const mark = await auditMark(env.owner);
  const t = await track(env, lis, run);
  if (status === "2xx") expect(t.res.status).toBeLessThan(300);
  else expect(t.res.status).toBe(status);
  expect(await audits(env, mark)).toHaveLength(0);
}

describe("ADM-FR-51 · M4-AC04 · catalog (snapshot)", () => {
  it("ADM-FR-51 · M4-AC04 · AW6 · POST command input_map có khoá password/value/iv → 201, đúng 1 dòng create (không 500)", async () => {
    const r = await one(
      ADMIN,
      () =>
        admin("POST", "/admin/commands", {
          name: "aw6-cmd",
          description: { vi: "AW6" },
          workflow_id: W.translate,
          args: [{ name: "text", description: { vi: "Văn bản" }, rest: true }],
          input_map: {
            password: { source: "arg", value: "text" },
            value: { source: "arg", value: "text" },
            iv: { source: "arg", value: "text" },
          },
          output: { field: "text", render: "text" },
        }),
      { action: "create", entity: "command", entity_name: "/aw6-cmd", before: null, ...NULL_T },
    );
    expect(Object.keys((r.after?.input_map ?? {}) as object).sort()).toEqual([
      "iv",
      "password",
      "value",
    ]);
  });

  it("ADM-FR-51 · M4-AC04 · AW6 · command PATCH /dich (entity_name '/dich', entity_version = version sau) / DELETE (after null)", async () => {
    const v = await ver("commands", CMD.dich);
    const p = await one(
      ADMIN,
      () => admin("PATCH", `/admin/commands/${CMD.dich}`, { version: v, description: { vi: "B" } }),
      {
        action: "update",
        entity: "command",
        entity_id: CMD.dich,
        entity_name: "/dich",
        entity_version: v + 1,
        ...NULL_T,
      },
    );
    expect(p.after?.description).toEqual({ vi: "B" });
    expect(p.before?.version).toBe(v);
    const d = await one(ADMIN, () => admin("DELETE", `/admin/commands/${CMD.trNhanh}`), {
      action: "delete",
      entity: "command",
      after: null,
      ...NULL_T,
    });
    expect(d.before).not.toBeNull();
  });

  it("ADM-FR-51 · M4-AC04 · AW6 · workflow POST/PATCH/DELETE → create/update/delete · NULL · snapshot", async () => {
    await one(
      ADMIN,
      () =>
        admin("POST", "/admin/workflows", {
          key: "aw6-wf",
          name: "Moi",
          description: "d".repeat(30),
          app_type: "workflow",
          base_url: "https://x.example.com",
          secret_id: ID.secret.old,
        }),
      { action: "create", entity: "workflow", entity_name: "aw6-wf", ...NULL_T },
    );
    const v = await ver("workflows", W.reportTax);
    await one(
      ADMIN,
      () => admin("PATCH", `/admin/workflows/${W.reportTax}`, { version: v, name: "Tax 2" }),
      {
        action: "update",
        entity: "workflow",
        entity_version: v + 1,
        ...NULL_T,
      },
    );
    await one(ADMIN, () => admin("DELETE", `/admin/workflows/${W.reportTax}`), {
      action: "delete",
      entity: "workflow",
      after: null,
      ...NULL_T,
    });
  });

  it("ADM-FR-51 · M4-AC04 · AW6 · feature POST/PATCH/DELETE → create/update/delete · NULL · snapshot", async () => {
    await one(
      ADMIN,
      () =>
        admin("POST", "/admin/features", { key: "nhan-su", name: { vi: "Nhân sự" }, status: "on" }),
      {
        action: "create",
        entity: "feature",
        entity_name: "nhan-su",
        ...NULL_T,
      },
    );
    const v = await ver("features", F.keToan);
    await one(
      ADMIN,
      () => admin("PATCH", `/admin/features/${F.keToan}`, { version: v, status: "beta" }),
      {
        action: "update",
        entity: "feature",
        entity_name: "ke-toan",
        entity_version: v + 1,
        ...NULL_T,
      },
    );
    await one(ADMIN, () => admin("DELETE", `/admin/features/${F.thuNghiem}`), {
      action: "delete",
      entity: "feature",
      after: null,
      ...NULL_T,
    });
  });
});

describe("ADM-FR-51 · M4-AC04 · secret", () => {
  it("ADM-FR-51 · M4-AC04 · AW7 · secret POST/PUT giá trị/PATCH note/DELETE → create/update/update/delete · NULL · snapshot false; PUT: summary.value_changed", async () => {
    const S = { entity: "secret", tenant_id: null, snapshot: false };
    await one(ADMIN, () => admin("POST", "/admin/secrets", { name: "DIFY_N_KEY", value: LEAK_1 }), {
      action: "create",
      entity_name: "DIFY_N_KEY",
      ...S,
    });
    const put = await one(
      ADMIN,
      () => admin("PUT", "/admin/secrets/DIFY_OLD_KEY", { value: LEAK_2 }),
      {
        action: "update",
        entity_name: "DIFY_OLD_KEY",
        ...S,
      },
    );
    expect(put.summary).toMatchObject({ value_changed: true });
    const note = await one(
      ADMIN,
      () => admin("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: "đã đổi" }),
      {
        action: "update",
        ...S,
      },
    );
    expect(note.summary.value_changed).toBeUndefined();
    await one(ADMIN, () => admin("DELETE", "/admin/secrets/DIFY_OLD_KEY"), {
      action: "delete",
      after: null,
      ...S,
    });
  });
});

describe("ADM-FR-51 · M4-R10 · không ghi", () => {
  it("ADM-FR-51 · M4-R10 · AW9 · no-op (PATCH group không đổi, grant đã có, entitlement đã có) → 0 dòng", async () => {
    await env.token("acme", "binh");
    await env.admin();
    const v = await ver("groups", KT);
    await none(
      () =>
        binh("PATCH", `/admin/groups/${KT}`, {
          version: v,
          name: { vi: "Kế toán", en: "Accounting" },
        }),
      200,
    );
    // ke-toan → nhóm ke-toan (g1) và entitlement ke-toan → acme đã có sẵn trong seed
    await none(() => binh("POST", "/admin/grants", { feature_id: F.keToan, group_id: KT }), "2xx");
    await none(() => admin("PUT", `/admin/features/${F.keToan}/entitlements/${A}`), "2xx");
  });

  it("ADM-FR-51 · M4-R10 · M4-AC04 · AW10 · afterLock ném ở bước bump khi PATCH /dich → 500, /dich không đổi, 0 dòng audit", async () => {
    const app = await env.makeApp4({
      hooks: {
        afterLock: (_op, step) => {
          if (step === "bump") throw new Error("AW10 hook");
        },
      },
    });
    const token = await env.admin();
    const v = await ver("commands", CMD.dich);
    const mark = await auditMark(env.owner);
    const res = await app.call("PATCH", `/admin/commands/${CMD.dich}`, {
      token,
      body: { version: v, description: { vi: "AW10" } },
    });
    expect(res.status).toBe(500);
    expect(await ver("commands", CMD.dich)).toBe(v);
    expect(await audits(env, mark)).toHaveLength(0);
  });

  it("ADM-FR-51 · Q6 · AW11 · login, refresh, logout, tự đổi mật khẩu, sai mật khẩu → 0 dòng", async () => {
    const login = (password: string) =>
      env.post("/auth/login", { body: { tenant_key: "acme", username: "an", password } });
    const mark = await auditMark(env.owner);
    const ok = await login(PW);
    expect(ok.status).toBe(200);
    const cookie = ok.cookies.find((c) => c.startsWith("ai_rt="))?.split(";")[0] ?? "";
    const ref = await env.post("/auth/refresh", { headers: { cookie } });
    expect(ref.status).toBe(200);
    expect((await login("Sai-Mat-Khau-1")).status).toBe(401);
    const token = ref.json.access_token as string;
    const ch = await env.post("/auth/change-password", {
      token,
      body: { current_password: PW, new_password: "Aw11-New-Passw0rd" },
    });
    expect(ch.status).toBe(204);
    const out = await env.post("/auth/logout", { token, headers: { cookie } });
    expect(out.status).toBeLessThan(300);
    await env.settle(lis, lis.msgs.length);
    expect(await audits(env, mark)).toHaveLength(0);
  });

  it("ADM-FR-51 · M4-R10 · AW12 · 409 VERSION_CONFLICT, 400 validate, 404 → 0 dòng", async () => {
    await env.token("acme", "binh");
    const v = await ver("groups", KT);
    await none(
      () => binh("PATCH", `/admin/groups/${KT}`, { version: v + 100, name: { vi: "X" } }),
      409,
    );
    await none(
      () => binh("POST", "/admin/groups", { key: "KHONG HOP LE", name: { vi: "X" } }),
      400,
    );
    await none(
      () => binh("PATCH", `/admin/groups/${ID4.unknown}`, { version: 1, name: { vi: "X" } }),
      404,
    );
  });
});
