// HUB-FR-68 · HUB-FR-69 · AC-H4b1-01, 03, 04 · Q4, Q7 · spec §3 A `/studio/api/secrets*` · test-plan H4b1 §3 A01–A19:
// quyền (401/403 trước parse), tạo/đọc/liệt kê chỉ metadata, validate + phạm vi theo loại, trùng tên không phân biệt
// hoa-thường, thay giá trị (version, VERSION_CONFLICT), xoá (version, SECRET_IN_USE + used_by), NOT_CONFIGURED khi Hub
// không có khoá. Đỏ trước code: route chưa mount ⇒ 404 ≠ kỳ vọng; bảng chưa có ⇒ helper trả -1/undefined (không PostgresError).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type Ctx,
  countByName,
  create,
  errOf,
  expectMeta,
  expectNoValue,
  idGen,
  idOf,
  NONE,
  secretRow,
  startH4b1,
  stateOf,
  studio,
  T,
  val,
} from "./_h4b1";

let x: Ctx;
const _id = idGen(1000);
beforeAll(async () => {
  x = await startH4b1();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

/** 0 ghi: hàng secrets + version + audit giữ nguyên quanh `f`. */
async function noWrite(f: () => Promise<{ status: number }>, status: number, code: string) {
  const s0 = await stateOf(x.sql);
  const r = (await f()) as never;
  expect(errOf(r)).toMatchObject({ status, code });
  expect(await stateOf(x.sql)).toEqual(s0);
  return r as { json: { error?: { details?: { issues?: { path: unknown }[] } } } };
}
const paths = (r: { json: { error?: { details?: { issues?: { path: unknown }[] } } } }) =>
  (r.json?.error?.details?.issues ?? []).map((i) =>
    Array.isArray(i.path) ? i.path.join(".") : String(i.path),
  );

describe("A01–A03 · quyền [spec §3 A · HUB-FR-68]", () => {
  const eps = (sid: string) =>
    [
      ["GET", ""],
      ["POST", "", { kind: "provider_api_key", name: "qc-role", value: val("role") }],
      ["GET", `/${sid}`],
      ["PUT", `/${sid}`, { version: 1, value: val("role2") }],
      ["DELETE", `/${sid}?version=1`],
    ] as const;
  it("HUB-FR-68 · A01 · không token ⇒ 401 AUTH_EXPIRED ở 5 endpoint", async () => {
    const got = [];
    for (const [m, p, b] of eps(NONE)) got.push(errOf(await studio(x, null, m, p, b)).status);
    expect(got).toEqual([401, 401, 401, 401, 401]);
  });
  it("HUB-FR-68 · AC-H4b1-05 · A02 · tadmin / lan ⇒ 403 FORBIDDEN ở 5 endpoint (kể cả body sai: 403 trước parse) + 0 ghi", async () => {
    const s0 = await stateOf(x.sql);
    const got: string[] = [];
    for (const w of ["tadmin", "lan"] as const) {
      for (const [m, p, b] of eps(NONE)) got.push(`${errOf(await studio(x, w, m, p, b)).code}`);
      got.push(`${errOf(await studio(x, w, "POST", "", { rac: 1 })).code}`);
    }
    expect(got).toEqual(Array(12).fill("FORBIDDEN"));
    expect(await stateOf(x.sql)).toEqual(s0);
  });
  it("HUB-FR-68 · AC-H4b1-05 · A03 · tadmin POST provider_api_key / kh_api_key qua Studio ⇒ 403, không tạo hàng", async () => {
    const r1 = await studio(x, "tadmin", "POST", "", {
      kind: "provider_api_key",
      name: "qc-a03",
      value: val("a03"),
    });
    const r2 = await studio(x, "tadmin", "POST", "", {
      kind: "kh_api_key",
      name: "qc-a03",
      value: val("a03"),
    });
    expect([r1.status, r2.status]).toEqual([403, 403]);
    expect(await countByName(x.sql, "qc-a03")).toBe(0);
  });
});

describe("A04–A09 · tạo + đọc chỉ metadata [AC-H4b1-01 · spec §2 Chỉ ghi]", () => {
  it("HUB-FR-68 · AC-H4b1-01 · A04 · POST provider_api_key `anthropic-main` ⇒ 201 HubSecret v1, tenant null, used_by [], không giá trị; DB có hàng", async () => {
    const v = val("a04");
    const r = await create(x, { kind: "provider_api_key", name: "anthropic-main", value: v });
    expect(r.status).toBe(201);
    await expectMeta(r.json);
    expect(r.json).toMatchObject({
      kind: "provider_api_key",
      name: "anthropic-main",
      tenant: null,
      version: 1,
      used_by: [],
    });
    expectNoValue(r.text, [v]);
    const row = await secretRow(x.sql, idOf(r));
    expect({
      kind: row?.kind,
      tenant: row?.tenant_id,
      version: row?.version,
      kv: row?.key_version,
    }).toEqual({
      kind: "provider_api_key",
      tenant: null,
      version: 1,
      kv: 1,
    });
  });
  it("HUB-FR-68 · AC-H4b1-01 · A05 · GET /:id và GET list ⇒ cùng metadata, không giá trị", async () => {
    const v = val("a05");
    const c = await create(x, { kind: "provider_api_key", name: "qc-a05", value: v });
    expect(c.status).toBe(201);
    const g = await studio(x, "padmin", "GET", `/${idOf(c)}`);
    const l = await studio(x, "padmin", "GET", "?kind=provider_api_key&q=qc-a05");
    expect([g.status, l.status]).toEqual([200, 200]);
    await expectMeta(g.json);
    expect(g.json).toEqual(c.json);
    expect(l.json.items).toEqual([c.json]);
    expect(l.json.next_cursor).toBeNull();
    expectNoValue(g.text + l.text, [v]);
  });
  it("HUB-FR-68 · A06 · GET /:id uuid lạ / không phải uuid ⇒ 404 NOT_FOUND cùng thân", async () => {
    const a = await studio(x, "padmin", "GET", `/${NONE}`);
    const b = await studio(x, "padmin", "GET", "/khong-phai-uuid");
    expect([errOf(a).code, errOf(b).code, a.status, b.status]).toEqual([
      "NOT_FOUND",
      "NOT_FOUND",
      404,
      404,
    ]);
  });
  it("HUB-FR-68 · Q7 · A07 · kh_api_key nền tảng + theo tenant acme (giá trị JSON mờ đục) ⇒ 201; tenant ref {id, key, name}", async () => {
    const v = JSON.stringify({ client_id: "kh-ns-acme", client_secret: "QcKhSecret-A07-xyz" });
    const a = await create(x, { kind: "kh_api_key", name: "kh-main", value: val("a07") });
    const b = await create(x, { kind: "kh_api_key", name: "kh-acme", value: v, tenant_id: T.acme });
    expect([a.status, b.status]).toEqual([201, 201]);
    const [t] = await x.sql`select key, name from admin.tenants where id = ${T.acme}`;
    expect([a.json.tenant, b.json.tenant]).toEqual([
      null,
      { id: T.acme, key: t?.key, name: t?.name },
    ]);
    expectNoValue(b.text, ["QcKhSecret-A07-xyz"]);
  });
  it("HUB-FR-68 · CR-060 · A08 · platform_admin tạo source_credential cho tenant beta qua Studio ⇒ 201, tenant beta", async () => {
    const r = await create(x, {
      kind: "source_credential",
      name: "git-beta",
      value: val("a08"),
      tenant_id: T.beta,
    });
    expect(r.status).toBe(201);
    expect(r.json.tenant?.id).toBe(T.beta);
  });
  it("HUB-FR-68 · A09 · bản rõ dài 2048 + Unicode ⇒ 201 (giới hạn đếm UTF-16)", async () => {
    const r = await create(x, {
      kind: "provider_api_key",
      name: "qc-a09",
      value: `Đ🔑${"x".repeat(2045)}`,
    });
    expect(r.status).toBe(201);
  });
});

describe("A10–A15 · validate + phạm vi + trùng tên [spec §2 Tên · §3 · Q4]", () => {
  const bad: [string, () => Promise<{ status: number }>, string][] = [
    [
      "name 1 ký tự",
      () => create(x, { kind: "provider_api_key", name: "a", value: val("v") }),
      "name",
    ],
    [
      "name có khoảng trắng",
      () => create(x, { kind: "provider_api_key", name: "co cach", value: val("v") }),
      "name",
    ],
    [
      "name 65 ký tự",
      () => create(x, { kind: "provider_api_key", name: "x".repeat(65), value: val("v") }),
      "name",
    ],
    [
      "value 7 ký tự",
      () => create(x, { kind: "provider_api_key", name: "qc-a10", value: "Qc7Leak" }),
      "value",
    ],
    [
      "value 2049",
      () => create(x, { kind: "provider_api_key", name: "qc-a10", value: "y".repeat(2049) }),
      "value",
    ],
    [
      "kind lạ",
      () => studio(x, "padmin", "POST", "", { kind: "app_key", name: "qc-a10", value: val("v") }),
      "kind",
    ],
    [
      "provider + tenant_id",
      () =>
        create(x, { kind: "provider_api_key", name: "qc-a10", value: val("v"), tenant_id: T.acme }),
      "tenant_id",
    ],
    [
      "source_credential vắng tenant_id",
      () => create(x, { kind: "source_credential", name: "qc-a10", value: val("v") }),
      "tenant_id",
    ],
    [
      "tenant_id không có trong admin.tenants",
      () => create(x, { kind: "kh_api_key", name: "qc-a10", value: val("v"), tenant_id: NONE }),
      "tenant_id",
    ],
  ];
  for (const [name, f, path] of bad)
    it(`HUB-FR-68 · A10 · POST ${name} ⇒ 400 VALIDATION_ERROR path ${path} + 0 ghi`, async () => {
      const r = await noWrite(f, 400, "VALIDATION_ERROR");
      expect(paths(r)).toContain(path);
    });
  it("HUB-FR-68 · A11 · POST trường thừa (strict) ⇒ 400 + 0 ghi; thân lỗi không chứa giá trị", async () => {
    const v = val("a11");
    const r = await noWrite(
      () =>
        studio(x, "padmin", "POST", "", {
          kind: "provider_api_key",
          name: "qc-a11",
          value: v,
          note: "x",
        }),
      400,
      "VALIDATION_ERROR",
    );
    expectNoValue(JSON.stringify(r.json), [v, "Qc7Leak"]);
  });
  it("HUB-FR-68 · Q4 · A12 · trùng tên khác hoa-thường cùng (kind, tenant) ⇒ 409 SECRET_NAME_TAKEN + 0 ghi", async () => {
    expect(
      (await create(x, { kind: "provider_api_key", name: "Dup-Key", value: val("a12") })).status,
    ).toBe(201);
    await noWrite(
      () => create(x, { kind: "provider_api_key", name: "dup-KEY", value: val("a12b") }),
      409,
      "SECRET_NAME_TAKEN",
    );
  });
  it("HUB-FR-68 · Q4 · A13 · cùng tên khác kind / khác tenant ⇒ 201", async () => {
    const a = await create(x, { kind: "kh_api_key", name: "Dup-Key", value: val("a13") });
    const b = await create(x, {
      kind: "source_credential",
      name: "same-src",
      value: val("a13"),
      tenant_id: T.acme,
    });
    const c = await create(x, {
      kind: "source_credential",
      name: "SAME-src",
      value: val("a13"),
      tenant_id: T.beta,
    });
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
  });
  it("HUB-FR-68 · Q7 · A14 · kh_api_key trùng tên: nền tảng vs tenant acme ⇒ 201 cả hai; hai bản nền tảng ⇒ 409", async () => {
    const a = await create(x, { kind: "kh_api_key", name: "kh-dup", value: val("a14") });
    const b = await create(x, {
      kind: "kh_api_key",
      name: "kh-dup",
      value: val("a14"),
      tenant_id: T.acme,
    });
    expect([a.status, b.status]).toEqual([201, 201]);
    await noWrite(
      () => create(x, { kind: "kh_api_key", name: "KH-dup", value: val("a14") }),
      409,
      "SECRET_NAME_TAKEN",
    );
  });
});

describe("A16–A21 · thay giá trị [AC-H4b1-03 · HUB-FR-69]", () => {
  it("HUB-FR-69 · AC-H4b1-03 · A16 · PUT version đúng ⇒ 200 v2, metadata khác giữ nguyên, iv + bản mã đổi", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a16", value: val("a16") });
    const before = await secretRow(x.sql, idOf(c));
    const r = await studio(x, "padmin", "PUT", `/${idOf(c)}`, {
      version: 1,
      value: val("a16-moi"),
    });
    expect(r.status).toBe(200);
    await expectMeta(r.json);
    expect(r.json).toMatchObject({
      id: idOf(c),
      name: "qc-a16",
      kind: "provider_api_key",
      tenant: null,
      version: 2,
    });
    const after = await secretRow(x.sql, idOf(c));
    expect(Buffer.from(after?.iv ?? []).equals(Buffer.from(before?.iv ?? []))).toBe(false);
    expect(Buffer.from(after?.ciphertext ?? []).equals(Buffer.from(before?.ciphertext ?? []))).toBe(
      false,
    );
    expectNoValue(r.text, [val("a16"), val("a16-moi")]);
  });
  it("HUB-FR-69 · AC-H4b1-03 · A17 · PUT version cũ ⇒ 409 VERSION_CONFLICT {current (v2, không giá trị), updated_at} + 0 ghi", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a17", value: val("a17") });
    expect(
      (await studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: val("a17-2") })).status,
    ).toBe(200);
    const r = (await noWrite(
      () => studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: val("a17-3") }),
      409,
      "VERSION_CONFLICT",
    )) as never as {
      json: {
        error: {
          details: { current: { version: number; updated_at: string }; updated_at: string };
        };
      };
      text: string;
    };
    await expectMeta(r.json.error.details.current);
    expect(r.json.error.details.current.version).toBe(2);
    expect(r.json.error.details.updated_at).toBe(r.json.error.details.current.updated_at);
    expectNoValue(r.text, [val("a17"), val("a17-2"), val("a17-3")]);
  });
  it("HUB-FR-69 · A18 · PUT kèm name / kind / tenant_id (bất biến, strict) ⇒ 400 + 0 ghi", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a18", value: val("a18") });
    for (const extra of [{ name: "doi-ten" }, { kind: "kh_api_key" }, { tenant_id: T.acme }])
      await noWrite(
        () =>
          studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: val("a18b"), ...extra }),
        400,
        "VALIDATION_ERROR",
      );
  });
  it("HUB-FR-69 · A19 · PUT id lạ ⇒ 404; value 7 ký tự ⇒ 400", async () => {
    await noWrite(
      () => studio(x, "padmin", "PUT", `/${NONE}`, { version: 1, value: val("a19") }),
      404,
      "NOT_FOUND",
    );
    const c = await create(x, { kind: "provider_api_key", name: "qc-a19", value: val("a19") });
    await noWrite(
      () => studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: "short07" }),
      400,
      "VALIDATION_ERROR",
    );
  });
});
