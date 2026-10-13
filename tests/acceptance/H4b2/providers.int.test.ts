// HUB-FR-66 · HUB-FR-69 · AC-H4b2-01 · AC-H4b2-03 (vế xoá) · spec H4b2 §2, §3 A, §4 · plan §3.1 · test-plan H4b2 §3
// A01–A24: CRUD provider qua hub-api thật + DB tag riêng — tạo (api gắn secret H4b-1 / subscription), hình dạng, tham chiếu
// secret, KEY_TAKEN, chi tiết, sửa (version, VERSION_CONFLICT, không đổi ⇒ không bump), bật/tắt, readonly `dify`, xoá
// (PROVIDER_IN_USE kèm profile, PROVIDER_HAS_HISTORY, cascade state), list giữ H4a-R13 + `version`/`slots_in_use`.
// Đỏ trước code: route chưa mount ⇒ 404 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiBody,
  auditMax,
  auditSince,
  type Ctx,
  cfgState,
  DIFY,
  errOf,
  expectNoKey,
  expectSchema,
  insertJob,
  type Json,
  KEY,
  mkProfile,
  mkProvider,
  NONE,
  pa,
  pathsOf,
  providerRow,
  putBody,
  type Res,
  SEC,
  SEC_NAME,
  setState,
  startH4b2,
  step,
  subBody,
  versionOf,
} from "./_h4b2";

let x: Ctx;
beforeAll(async () => {
  x = await startH4b2();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

/** Gọi `f`, khẳng định `status`/`code` và 0 ghi (provider/profile/version/audit không đổi). */
async function noWrite(f: () => Promise<Res>, status: number, code: string): Promise<Res> {
  const s0 = await cfgState(x.sql);
  const r = await f();
  expect([r.status, errOf(r).code]).toEqual([status, code]);
  expect(await cfgState(x.sql)).toEqual(s0);
  return r;
}
const detail = async (id: string): Promise<Json> => (await pa(x, "GET", `/providers/${id}`)).json;

describe("A01–A08 · tạo provider [AC-H4b2-01 · spec §3 A POST · plan §3.1]", () => {
  it("HUB-FR-66 · AC-H4b2-01 · A01 · POST api gắn secret H4b-1 ⇒ 201 ProviderDetail v1, secret {id,name}, has_secret, dev_only (fake), không lộ giá trị", async () => {
    const v0 = await versionOf(x.sql);
    const r = await pa(x, "POST", "/providers", apiBody("qc-fake-api"));
    expect(r.status).toBe(201);
    await expectSchema("ProviderDetailSchema", r.json);
    expect(r.json).toMatchObject({
      key: "qc-fake-api",
      kind: "api",
      vendor: "fake",
      base_url: null,
      has_secret: true,
      secret: { id: SEC.ok, name: SEC_NAME.ok },
      max_concurrency: 1,
      enabled: true,
      dev_only: true,
      readonly: false,
      version: 1,
      slots_in_use: 0,
      state: null,
      used_by_profiles: [],
    });
    expectNoKey(r.text);
    expect((await providerRow(x.sql, "qc-fake-api"))?.secret_id).toBe(SEC.ok);
    expect(await versionOf(x.sql)).toBe(v0 + 1);
  });

  it("HUB-FR-69 · AC-H4b2-01 · A02 · audit create: entity provider, tenant_id null, entity_name = key, after.secret_id = id (không giá trị)", async () => {
    const m = await auditMax(x.sql);
    const d = await mkProvider(
      x,
      apiBody("qc-audit-api", { vendor: "anthropic", secret_id: SEC.anth }),
    );
    const [a] = await auditSince(x.sql, m, { entityId: d.id });
    expect(a).toMatchObject({
      entity: "provider",
      action: "create",
      tenant_id: null,
      entity_name: "qc-audit-api",
    });
    expect(a?.after?.secret_id).toBe(SEC.anth);
    expectNoKey(JSON.stringify(a));
    expect(d.dev_only).toBe(false);
  });

  it("HUB-FR-66 · A03 · POST subscription max_concurrency 3 ⇒ 201, has_secret false, secret null", async () => {
    const d = await mkProvider(
      x,
      subBody("qc-codex-sub", { vendor: "openai", max_concurrency: 3 }),
    );
    expect(d).toMatchObject({
      kind: "subscription",
      has_secret: false,
      secret: null,
      max_concurrency: 3,
    });
  });

  it("HUB-FR-66 · A04 · mặc định: bỏ max_concurrency/enabled ⇒ 1/true; base_url http://127.0.0.1 ở APP_ENV test ⇒ 201", async () => {
    const r = await pa(x, "POST", "/providers", {
      key: "qc-local-api",
      kind: "api",
      vendor: "openai",
      base_url: "http://127.0.0.1:18080",
      secret_id: SEC.openai,
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      max_concurrency: 1,
      enabled: true,
      base_url: "http://127.0.0.1:18080",
    });
  });

  it("HUB-FR-66 · A05 · hình dạng sai ⇒ 400 VALIDATION_ERROR đúng path; 0 ghi", async () => {
    const cases: [Json, string][] = [
      [apiBody("qc-a05-a", { secret_id: null }), "secret_id"],
      [subBody("qc-a05-b", { secret_id: SEC.ok }), "secret_id"],
      [subBody("qc-a05-c", { base_url: "https://api.example.test" }), "base_url"],
      [apiBody("qc-a05-d", { base_url: "http://api.example.test" }), "base_url"],
      [apiBody("qc-a05-e", { base_url: "https://u:p@api.example.test" }), "base_url"],
      [apiBody("qc-a05-f", { base_url: "https://api.example.test/v1?k=1" }), "base_url"],
      [apiBody("qc-a05-g", { vendor: "dify" }), "vendor"],
      [apiBody("Qc_Bad", {}), "key"],
      [subBody("qc-a05-h", { max_concurrency: 0 }), "max_concurrency"],
      [subBody("qc-a05-i", { max_concurrency: 101 }), "max_concurrency"],
    ];
    for (const [body, path] of cases) {
      const r = await noWrite(() => pa(x, "POST", "/providers", body), 400, "VALIDATION_ERROR");
      expect([body.key, pathsOf(r)]).toEqual([body.key, [path]]);
    }
  });

  it("HUB-FR-66 · A06 · thân có `value`/`api_key` (Q7) ⇒ 400; 0 ghi", async () => {
    for (const extra of [{ value: KEY.ok }, { api_key: KEY.ok }]) {
      const r = await noWrite(
        () => pa(x, "POST", "/providers", apiBody("qc-a06", extra)),
        400,
        "VALIDATION_ERROR",
      );
      expectNoKey(r.text);
    }
  });

  it("HUB-FR-66 · A07 · secret_id không có ⇒ INVALID_REFERENCE{secret_id, not_found}; kh_api_key ⇒ wrong_kind; 0 ghi", async () => {
    const a = await noWrite(
      () => pa(x, "POST", "/providers", apiBody("qc-a07-a", { secret_id: NONE })),
      400,
      "INVALID_REFERENCE",
    );
    expect(errOf(a).details).toMatchObject({ field: "secret_id", reason: "not_found" });
    const b = await noWrite(
      () => pa(x, "POST", "/providers", apiBody("qc-a07-b", { secret_id: SEC.kh })),
      400,
      "INVALID_REFERENCE",
    );
    expect(errOf(b).details).toMatchObject({ field: "secret_id", reason: "wrong_kind" });
  });

  it("HUB-FR-66 · A08 · key đã có (claude-sub) ⇒ 409 KEY_TAKEN; 0 ghi", async () => {
    await noWrite(() => pa(x, "POST", "/providers", subBody("claude-sub")), 409, "KEY_TAKEN");
  });
});

describe("A09–A16 · chi tiết, sửa, bật/tắt, readonly [spec §3 A · Q8 · D11]", () => {
  it("HUB-FR-66 · A09 · GET :id ⇒ ProviderDetail; id lạ ⇒ 404; dify ⇒ readonly true", async () => {
    const d = await mkProvider(x, apiBody("qc-a09"));
    const r = await pa(x, "GET", `/providers/${d.id}`);
    expect(r.status).toBe(200);
    await expectSchema("ProviderDetailSchema", r.json);
    expect(r.json).toMatchObject({ id: d.id, key: "qc-a09", version: 1 });
    expect(typeof r.json.updated_at).toBe("string");
    expect(errOf(await pa(x, "GET", `/providers/${NONE}`))).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    expect((await pa(x, "GET", `/providers/${DIFY.id}`)).json?.readonly).toBe(true);
  });

  it("HUB-FR-66 · A10 · PUT đổi base_url + secret ⇒ 200 v2; DB đổi; audit update có before/after; version +1", async () => {
    const d = await mkProvider(x, apiBody("qc-a10", { vendor: "openai", secret_id: SEC.openai }));
    const v0 = await versionOf(x.sql);
    const m = await auditMax(x.sql);
    const r = await pa(
      x,
      "PUT",
      `/providers/${d.id}`,
      putBody(d, { base_url: "https://proxy.example.test", secret_id: SEC.anth }),
    );
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      version: 2,
      base_url: "https://proxy.example.test",
      secret: { id: SEC.anth, name: SEC_NAME.anth },
    });
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    const [a] = await auditSince(x.sql, m, { entityId: d.id, action: "update" });
    expect(a?.before?.secret_id).toBe(SEC.openai);
    expect(a?.after?.secret_id).toBe(SEC.anth);
    expectNoKey(JSON.stringify(a));
  });

  it("HUB-FR-66 · A11 · PUT version cũ ⇒ 409 VERSION_CONFLICT{current v2, updated_at}; 0 ghi", async () => {
    const d = await mkProvider(x, apiBody("qc-a11"));
    expect(
      (await pa(x, "PUT", `/providers/${d.id}`, putBody(d, { max_concurrency: 2 }))).status,
    ).toBe(200);
    const r = await noWrite(
      () => pa(x, "PUT", `/providers/${d.id}`, putBody(d, { max_concurrency: 5 })),
      409,
      "VERSION_CONFLICT",
    );
    expect(errOf(r).details?.current).toMatchObject({ id: d.id, version: 2, max_concurrency: 2 });
    expect(typeof errOf(r).details?.updated_at).toBe("string");
  });

  it("HUB-FR-66 · A12 · PUT có key/kind/vendor (Q8 bất biến) ⇒ 400; 0 ghi", async () => {
    const d = await mkProvider(x, apiBody("qc-a12"));
    for (const extra of [{ key: "qc-a12-x" }, { kind: "subscription" }, { vendor: "openai" }])
      await noWrite(
        () => pa(x, "PUT", `/providers/${d.id}`, putBody(d, extra)),
        400,
        "VALIDATION_ERROR",
      );
  });

  it("HUB-FR-66 · A13 · PUT không đổi gì ⇒ 200 cùng version; không bump, không audit", async () => {
    const d = await mkProvider(x, apiBody("qc-a13"));
    const s0 = await cfgState(x.sql);
    const r = await pa(x, "PUT", `/providers/${d.id}`, putBody(d));
    expect([r.status, r.json?.version]).toEqual([200, 1]);
    expect(await cfgState(x.sql)).toEqual(s0);
  });

  it("HUB-FR-66 · A14 · PUT subscription gắn secret ⇒ 400 path secret_id (hình dạng theo kind DB); id lạ ⇒ 404", async () => {
    const d = await mkProvider(x, subBody("qc-a14"));
    const r = await noWrite(
      () => pa(x, "PUT", `/providers/${d.id}`, putBody(d, { secret_id: SEC.ok })),
      400,
      "VALIDATION_ERROR",
    );
    expect(pathsOf(r)).toEqual(["secret_id"]);
    await noWrite(() => pa(x, "PUT", `/providers/${NONE}`, putBody(d)), 404, "NOT_FOUND");
  });

  it("HUB-FR-66 · A15 · PATCH enabled false ⇒ v+1, audit disable; true ⇒ audit enable; version cũ ⇒ 409", async () => {
    const d = await mkProvider(x, subBody("qc-a15"));
    const m = await auditMax(x.sql);
    const r1 = await pa(x, "PATCH", `/providers/${d.id}/enabled`, { version: 1, enabled: false });
    expect(r1.json).toMatchObject({ enabled: false, version: 2 });
    const r2 = await pa(x, "PATCH", `/providers/${d.id}/enabled`, { version: 2, enabled: true });
    expect(r2.json).toMatchObject({ enabled: true, version: 3 });
    const acts = (await auditSince(x.sql, m, { entityId: d.id })).map((a) => a.action);
    expect(acts).toEqual(["disable", "enable"]);
    await noWrite(
      () => pa(x, "PATCH", `/providers/${d.id}/enabled`, { version: 1, enabled: false }),
      409,
      "VERSION_CONFLICT",
    );
  });

  it("HUB-FR-66 · A16 · dify (readonly) ⇒ PUT / PATCH / DELETE / check đều 409 PROVIDER_READONLY; 0 ghi", async () => {
    const id = DIFY.id;
    const b = { version: 1, base_url: null, secret_id: null, max_concurrency: 1, enabled: false };
    await noWrite(() => pa(x, "PUT", `/providers/${id}`, b), 409, "PROVIDER_READONLY");
    await noWrite(
      () => pa(x, "PATCH", `/providers/${id}/enabled`, { version: 1, enabled: false }),
      409,
      "PROVIDER_READONLY",
    );
    await noWrite(() => pa(x, "DELETE", `/providers/${id}?version=1`), 409, "PROVIDER_READONLY");
    await noWrite(() => pa(x, "POST", `/providers/${id}/check`), 409, "PROVIDER_READONLY");
  });
});

describe("A17–A21 · xoá [AC-H4b2-03 · Q2 · spec §3 A DELETE · §4]", () => {
  it("HUB-FR-66 · AC-H4b2-03 · A17 · provider đang là bước của profile ⇒ 409 PROVIDER_IN_USE{profiles:[{id,key}]} (tên profile); 0 ghi", async () => {
    const d = await mkProvider(x, apiBody("qc-a17", { vendor: "openai", secret_id: SEC.openai }));
    const p1 = await mkProfile(x, "smart", [step("qc-a17", ["quota"]), step("claude-sub")]);
    const p2 = await mkProfile(x, "coder", [step("claude-sub", ["error"]), step("qc-a17")]);
    const r = await noWrite(
      () => pa(x, "DELETE", `/providers/${d.id}?version=1`),
      409,
      "PROVIDER_IN_USE",
    );
    const got = (errOf(r).details?.profiles ?? []) as { id: string; key: string }[];
    expect([...got].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { id: p2.id, key: "coder" },
      { id: p1.id, key: "smart" },
    ]);
    expect((await detail(d.id))?.used_by_profiles?.length).toBe(2);
  });

  it("HUB-FR-66 · A18 · provider đã có job (lịch sử) ⇒ 409 PROVIDER_HAS_HISTORY; 0 ghi; tắt được", async () => {
    const d = await mkProvider(x, subBody("qc-a18"));
    await insertJob(x.sql, "qc-a18", "succeeded");
    await noWrite(
      () => pa(x, "DELETE", `/providers/${d.id}?version=1`),
      409,
      "PROVIDER_HAS_HISTORY",
    );
    const r = await pa(x, "PATCH", `/providers/${d.id}/enabled`, { version: 1, enabled: false });
    expect(r.status).toBe(200);
  });

  it("HUB-FR-66 · A19 · xoá được ⇒ 204; hàng + provider_state biến mất (cascade); audit delete; version +1", async () => {
    const d = await mkProvider(x, subBody("qc-a19"));
    await setState(x.sql, "qc-a19", { status: "ok" });
    const v0 = await versionOf(x.sql);
    const m = await auditMax(x.sql);
    const r = await pa(x, "DELETE", `/providers/${d.id}?version=1`);
    expect(r.status).toBe(204);
    expect(await providerRow(x.sql, "qc-a19")).toBeUndefined();
    const [s] = await x.sql`select 1 from hub.provider_state where provider_key = 'qc-a19'`;
    expect(s).toBeUndefined();
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    expect((await auditSince(x.sql, m, { entityId: d.id })).map((a) => a.action)).toEqual([
      "delete",
    ]);
  });

  it("HUB-FR-66 · A20 · DELETE version cũ ⇒ VERSION_CONFLICT; id lạ ⇒ 404; thiếu version ⇒ 400; 0 ghi", async () => {
    const d = await mkProvider(x, subBody("qc-a20"));
    await noWrite(() => pa(x, "DELETE", `/providers/${d.id}?version=7`), 409, "VERSION_CONFLICT");
    await noWrite(() => pa(x, "DELETE", `/providers/${NONE}?version=1`), 404, "NOT_FOUND");
    await noWrite(() => pa(x, "DELETE", `/providers/${d.id}`), 400, "VALIDATION_ERROR");
  });

  it("HUB-FR-66 · A21 · DELETE provider seed claude-sub (profile claude-sub-1 dùng) ⇒ PROVIDER_IN_USE kèm claude-sub-1", async () => {
    const [p] = await x.sql<
      { id: string }[]
    >`select id from hub.providers where key = 'claude-sub'`;
    const r = await noWrite(
      () => pa(x, "DELETE", `/providers/${p?.id ?? NONE}?version=1`),
      409,
      "PROVIDER_IN_USE",
    );
    const keys = ((errOf(r).details?.profiles ?? []) as { key: string }[]).map((q) => q.key);
    expect(keys).toContain("claude-sub-1");
  });
});

describe("A22–A24 · list + chi tiết trạng thái sống [spec §3 A GET · Q6 · H4a-R13]", () => {
  it("HUB-FR-66 · A22 · GET /providers: item có version, slots_in_use = số job running; has_secret; KHÔNG secret_id/last_error (H4a A17)", async () => {
    await mkProvider(x, subBody("qc-a22", { max_concurrency: 4 }));
    await insertJob(x.sql, "qc-a22", "running");
    await insertJob(x.sql, "qc-a22", "running");
    await insertJob(x.sql, "qc-a22", "succeeded");
    await setState(x.sql, "qc-a22", { status: "error", lastError: "qc-a22 boom" });
    const r = await pa(x, "GET", "/providers");
    expect(r.status).toBe(200);
    await expectSchema("ProviderListSchema", r.json);
    const it22 = r.json.items.find((i: Json) => i.key === "qc-a22");
    expect(it22).toMatchObject({ version: 1, slots_in_use: 2, has_secret: false });
    for (const p of r.json.items) {
      expect(typeof p.version).toBe("number");
      for (const k of ["secret_id", "last_error", "secret", "ciphertext", "iv"])
        expect(Object.keys(p)).not.toContain(k);
    }
    for (const s of ["secret_id", "last_error", "qc-a22 boom", SEC.ok])
      expect(r.text).not.toContain(s);
  });

  it("HUB-FR-66 · A23 · GET :id có state {status, cooldown_until, last_probe_at, last_ok_at, utilization, last_error} (chỉ chi tiết)", async () => {
    const d = await mkProvider(x, subBody("qc-a23"));
    await setState(x.sql, "qc-a23", {
      status: "cooldown",
      cooldown: "2099-01-01T00:00:00Z",
      lastError: "rate limited · 429",
    });
    const r = await detail(d.id);
    expect(r?.state).toMatchObject({ status: "cooldown", last_error: "rate limited · 429" });
    expect(r?.state?.cooldown_until).toMatch(/^2099-01-01T00:00:00/);
  });

  it("HUB-FR-66 · A24 · không lộ: response tạo/chi tiết/list + audit provider không chứa giá trị secret nào", async () => {
    const m = await auditMax(x.sql);
    const d = await mkProvider(x, apiBody("qc-a24", { vendor: "google", secret_id: SEC.google }));
    const texts = [
      (await pa(x, "GET", `/providers/${d.id}`)).text,
      (await pa(x, "GET", "/providers")).text,
      JSON.stringify(await auditSince(x.sql, m)),
    ];
    for (const t of texts) expectNoKey(t);
  });
});
