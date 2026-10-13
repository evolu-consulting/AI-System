// HUB-FR-68 · HUB-BR-15 · HUB-BR-14 · CR-060 · AC-H4b1-05 · Q1 · spec §3 B `/admin/source-credentials*` · test-plan H4b1
// §3 A40–A52: tenant_admin chỉ source_credential của tenant mình; tenant khác / loại khác ⇒ 404 cùng thân; member 403;
// platform_admin phải gửi tenant_id (ghi vắng 400, đọc vắng 404); list theo tenant; audit tenant. Đỏ trước code: prefix
// chưa mount ⇒ 401/404 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { expectSame404 } from "../H3b/_h3b";
import {
  auditMax,
  auditSince,
  BADMIN,
  type Ctx,
  countByName,
  create,
  errOf,
  expectMeta,
  expectNoValue,
  idOf,
  NONE,
  secretRow,
  startH4b1,
  stateOf,
  T,
  tenantApi,
  USERS,
  val,
} from "./_h4b1";

let x: Ctx;
beforeAll(async () => {
  x = await startH4b1();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

/** source_credential của acme do tadmin tạo qua route tenant. */
async function acmeCred(name: string) {
  const r = await tenantApi(x, "tadmin", "POST", "", { name, value: val(name) });
  expect(r.status).toBe(201);
  return idOf(r);
}

describe("A40–A42 · xác thực + vai trò [HUB-BR-14 · spec §3 B]", () => {
  it("HUB-BR-15 · A40 · không token ⇒ 401 ở GET/POST/GET id/PUT/DELETE", async () => {
    const got = [
      (await tenantApi(x, null, "GET")).status,
      (await tenantApi(x, null, "POST", "", { name: "qc-a40", value: val("a40") })).status,
      (await tenantApi(x, null, "GET", `/${NONE}`)).status,
      (await tenantApi(x, null, "PUT", `/${NONE}`, { version: 1, value: val("a40") })).status,
      (await tenantApi(x, null, "DELETE", `/${NONE}?version=1`)).status,
    ];
    expect(got).toEqual([401, 401, 401, 401, 401]);
  });
  it("HUB-BR-15 · AC-H4b1-05 · A41 · member (lan) ⇒ 403 FORBIDDEN ở 5 endpoint + 0 ghi", async () => {
    const s0 = await stateOf(x.sql);
    const got = [
      errOf(await tenantApi(x, "lan", "GET")).code,
      errOf(await tenantApi(x, "lan", "POST", "", { name: "qc-a41", value: val("a41") })).code,
      errOf(await tenantApi(x, "lan", "GET", `/${NONE}`)).code,
      errOf(await tenantApi(x, "lan", "PUT", `/${NONE}`, { version: 1, value: val("a41") })).code,
      errOf(await tenantApi(x, "lan", "DELETE", `/${NONE}?version=1`)).code,
    ];
    expect(got).toEqual(Array(5).fill("FORBIDDEN"));
    expect(await stateOf(x.sql)).toEqual(s0);
  });
  it("HUB-BR-15 · AC-H4b1-05 · A42 · tadmin gửi `kind` (provider_api_key / kh_api_key) ở route tenant ⇒ 400 (strict, không có kind) + không tạo", async () => {
    for (const kind of ["provider_api_key", "kh_api_key"]) {
      const r = await tenantApi(x, "tadmin", "POST", "", {
        kind,
        name: "qc-a42",
        value: val("a42"),
      });
      expect(errOf(r)).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    }
    expect(await countByName(x.sql, "qc-a42")).toBe(0);
  });
});

describe("A43–A46 · tenant_admin trong tenant mình [CR-060 · Q1]", () => {
  it("HUB-FR-68 · CR-060 · A43 · tadmin POST {name, value} ⇒ 201 source_credential tenant acme; DB tenant_id acme", async () => {
    const v = val("a43");
    const r = await tenantApi(x, "tadmin", "POST", "", { name: "git-acme", value: v });
    expect(r.status).toBe(201);
    await expectMeta(r.json);
    expect({ kind: r.json.kind, tenant: r.json.tenant?.id, version: r.json.version }).toEqual({
      kind: "source_credential",
      tenant: T.acme,
      version: 1,
    });
    expectNoValue(r.text, [v]);
    expect((await secretRow(x.sql, idOf(r)))?.tenant_id).toBe(T.acme);
  });
  it("HUB-FR-69 · A44 · tadmin PUT ⇒ 200 v2; DELETE ⇒ 204; audit create/rotate/delete tenant_id acme, actor tadmin", async () => {
    const m = await auditMax(x.sql);
    const sid = await acmeCred("qc-a44");
    expect(
      (await tenantApi(x, "tadmin", "PUT", `/${sid}`, { version: 1, value: val("a44-2") })).json
        ?.version,
    ).toBe(2);
    expect((await tenantApi(x, "tadmin", "DELETE", `/${sid}?version=2`)).status).toBe(204);
    const rows = await auditSince(x.sql, m, { entityId: sid });
    expect(rows.map((a) => [a.action, a.entity, a.tenant_id, a.actor_id, a.actor_role])).toEqual(
      ["create", "rotate", "delete"].map((a) => [
        a,
        "secret",
        T.acme,
        USERS.tadmin.id,
        "tenant_admin",
      ]),
    );
  });
  it("HUB-FR-68 · A45 · tadmin GET list ⇒ chỉ source_credential của acme (không beta, không kh_api_key acme, không nền tảng)", async () => {
    await acmeCred("qc-a45-acme");
    expect(
      (
        await create(x, {
          kind: "source_credential",
          name: "qc-a45-beta",
          value: val("a45b"),
          tenant_id: T.beta,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await create(x, {
          kind: "kh_api_key",
          name: "qc-a45-kh",
          value: val("a45k"),
          tenant_id: T.acme,
        })
      ).status,
    ).toBe(201);
    expect(
      (await create(x, { kind: "provider_api_key", name: "qc-a45-prov", value: val("a45p") }))
        .status,
    ).toBe(201);
    const r = await tenantApi(x, "tadmin", "GET", "?q=qc-a45");
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: { name: string }) => i.name)).toEqual(["qc-a45-acme"]);
    expect(
      r.json.items.every(
        (i: { kind: string; tenant: { id: string } }) =>
          i.kind === "source_credential" && i.tenant.id === T.acme,
      ),
    ).toBe(true);
  });
  it("HUB-FR-68 · Q4 · A46 · tadmin POST trùng tên (khác hoa-thường) trong acme ⇒ 409 SECRET_NAME_TAKEN; badmin cùng tên ở beta ⇒ 201", async () => {
    await acmeCred("Git-Shared");
    const dup = await tenantApi(x, "tadmin", "POST", "", { name: "git-SHARED", value: val("a46") });
    expect(errOf(dup)).toMatchObject({ status: 409, code: "SECRET_NAME_TAKEN" });
    const other = await tenantApi(x, "badmin", "POST", "", {
      name: "git-shared",
      value: val("a46b"),
    });
    expect(other.status).toBe(201);
    expect(other.json.tenant?.id).toBe(BADMIN.tid);
  });
});

describe("A47–A49 · cách ly tenant ⇒ 404 cùng thân [AC-H4b1-05 · HUB-BR-14]", () => {
  it("HUB-BR-15 · AC-H4b1-05 · A47 · badmin (beta) GET/PUT/DELETE source_credential của acme ⇒ 404 giống hệt id lạ; hàng nguyên vẹn", async () => {
    const sid = await acmeCred("qc-a47");
    const before = await secretRow(x.sql, sid);
    const pairs = [
      [
        await tenantApi(x, "badmin", "GET", `/${sid}`),
        await tenantApi(x, "badmin", "GET", `/${NONE}`),
      ],
      [
        await tenantApi(x, "badmin", "PUT", `/${sid}`, { version: 1, value: val("a47-hack") }),
        await tenantApi(x, "badmin", "PUT", `/${NONE}`, { version: 1, value: val("a47-hack") }),
      ],
      [
        await tenantApi(x, "badmin", "DELETE", `/${sid}?version=1`),
        await tenantApi(x, "badmin", "DELETE", `/${NONE}?version=1`),
      ],
    ];
    for (const [a, b] of pairs) expectSame404(a as never, b as never);
    expect(await secretRow(x.sql, sid)).toEqual(before);
  });
  it("HUB-BR-15 · AC-H4b1-05 · A48 · tadmin gửi tenant_id=beta (POST / GET list / GET id) ⇒ 404; không tạo hàng", async () => {
    const r1 = await tenantApi(x, "tadmin", "POST", "", {
      name: "qc-a48",
      value: val("a48"),
      tenant_id: T.beta,
    });
    const r2 = await tenantApi(x, "tadmin", "GET", `?tenant_id=${T.beta}`);
    expect([errOf(r1).code, errOf(r2).code]).toEqual(["NOT_FOUND", "NOT_FOUND"]);
    expect(await countByName(x.sql, "qc-a48")).toBe(0);
  });
  it("HUB-BR-15 · AC-H4b1-05 · A49 · tadmin GET/PUT/DELETE secret không phải source_credential (provider nền tảng, kh_api_key acme) ⇒ 404 cùng thân", async () => {
    const p = await create(x, { kind: "provider_api_key", name: "qc-a49-p", value: val("a49") });
    const k = await create(x, {
      kind: "kh_api_key",
      name: "qc-a49-k",
      value: val("a49k"),
      tenant_id: T.acme,
    });
    expect([p.status, k.status]).toEqual([201, 201]);
    for (const sid of [idOf(p), idOf(k)]) {
      expectSame404(
        await tenantApi(x, "tadmin", "GET", `/${sid}`),
        await tenantApi(x, "tadmin", "GET", `/${NONE}`),
      );
      expectSame404(
        await tenantApi(x, "tadmin", "PUT", `/${sid}`, { version: 1, value: val("a49-x") }),
        await tenantApi(x, "tadmin", "PUT", `/${NONE}`, { version: 1, value: val("a49-x") }),
      );
      expectSame404(
        await tenantApi(x, "tadmin", "DELETE", `/${sid}?version=1`),
        await tenantApi(x, "tadmin", "DELETE", `/${NONE}?version=1`),
      );
      expect((await secretRow(x.sql, sid))?.version).toBe(1);
    }
  });
});

describe("A50–A52 · platform_admin trên route tenant [spec §3 B · D13]", () => {
  it("HUB-BR-15 · A50 · padmin POST vắng tenant_id ⇒ 400 path tenant_id; có tenant_id=beta ⇒ 201 tenant beta", async () => {
    const a = await tenantApi(x, "padmin", "POST", "", { name: "qc-a50", value: val("a50") });
    expect(errOf(a)).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(
      (a.json?.error?.details?.issues ?? []).map((i: { path: unknown }) =>
        Array.isArray(i.path) ? i.path.join(".") : i.path,
      ),
    ).toContain("tenant_id");
    const b = await tenantApi(x, "padmin", "POST", "", {
      name: "qc-a50",
      value: val("a50"),
      tenant_id: T.beta,
    });
    expect(b.status).toBe(201);
    expect(b.json.tenant?.id).toBe(T.beta);
  });
  it("HUB-BR-15 · A51 · padmin GET list vắng tenant_id ⇒ 404; có tenant_id=beta ⇒ 200 chỉ beta", async () => {
    expect(
      (
        await create(x, {
          kind: "source_credential",
          name: "qc-a51",
          value: val("a51"),
          tenant_id: T.beta,
        })
      ).status,
    ).toBe(201);
    expect(errOf(await tenantApi(x, "padmin", "GET")).code).toBe("NOT_FOUND");
    const r = await tenantApi(x, "padmin", "GET", `?tenant_id=${T.beta}&q=qc-a51`);
    expect(r.status).toBe(200);
    expect(
      r.json.items.map((i: { name: string; tenant: { id: string } }) => [i.name, i.tenant.id]),
    ).toEqual([["qc-a51", T.beta]]);
  });
  it("HUB-BR-15 · A52 · padmin GET/PUT/DELETE id kèm ?tenant_id đúng ⇒ 200/200/204; tenant_id sai ⇒ 404", async () => {
    const sid = await acmeCred("qc-a52");
    expect(errOf(await tenantApi(x, "padmin", "GET", `/${sid}?tenant_id=${T.beta}`)).code).toBe(
      "NOT_FOUND",
    );
    expect((await tenantApi(x, "padmin", "GET", `/${sid}?tenant_id=${T.acme}`)).status).toBe(200);
    const put = await tenantApi(x, "padmin", "PUT", `/${sid}?tenant_id=${T.acme}`, {
      version: 1,
      value: val("a52-2"),
    });
    expect(put.status).toBe(200);
    expect(
      (await tenantApi(x, "padmin", "DELETE", `/${sid}?tenant_id=${T.acme}&version=2`)).status,
    ).toBe(204);
  });
});
