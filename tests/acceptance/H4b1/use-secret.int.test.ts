// HUB-FR-68 · HUB-BR-30 · HUB-FR-04 · AC-H4b1-07 (vế Hub) · AC-H4b1-02 · Q12 · plan §2.3, D12, D16 · test-plan H4b1 §3
// A80–A88: `HubSecretReader.useSecret(ref, fn)` — giải đúng theo (id, kind, tenant) qua `hub.secret_material`, sai ref ⇒
// `secret_missing`, bản mã hỏng ⇒ `decrypt_failed`, khoá vắng ⇒ `key_missing` (SecretUseError code NOT_CONFIGURED, reason
// credential, message không id/giá trị), log warn chỉ {secret_id, kind, failure}, không cache, không ghi job/trace/audit.
// Bản mã dựng bằng owner theo spec (không cần API). Đỏ trước code: module/bảng chưa có ⇒ đỏ ở expect.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connectDb, type Db } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import { setupH3b } from "../H3b/_h3b";
import {
  expectNoValue,
  HUB_KEY,
  idGen,
  loadUse,
  type Sql,
  seedSecret,
  specSeal,
  T,
  val,
} from "./_h4b1";

let owner: Sql;
let db: Db;
const id = idGen(4000);
const S = { prov: id(), khAcme: id(), srcAcme: id(), broken: id() };
const V = {
  prov: val("u-prov"),
  khAcme: val("u-kh"),
  srcAcme: val("u-src"),
  broken: val("u-broken"),
};
const logs: string[] = [];
const mkLog = (ctx: Record<string, unknown> = {}): Record<string, unknown> => {
  const w =
    (level: string) =>
    (msg: string, fields: Record<string, unknown> = {}) =>
      logs.push(JSON.stringify({ level, msg, ...ctx, ...fields }));
  return {
    debug: w("debug"),
    info: w("info"),
    warn: w("warn"),
    error: w("error"),
    fatal: w("fatal"),
    child: (c: Record<string, unknown>) => mkLog({ ...ctx, ...c }),
  };
};
beforeAll(async () => {
  owner = await setupH3b();
  db = connectDb(HUB_API_URL, 2);
  await seedSecret(owner, {
    id: S.prov,
    kind: "provider_api_key",
    tenantId: null,
    name: "u-prov",
    value: V.prov,
  });
  await seedSecret(owner, {
    id: S.khAcme,
    kind: "kh_api_key",
    tenantId: T.acme,
    name: "u-kh",
    value: V.khAcme,
  });
  await seedSecret(owner, {
    id: S.srcAcme,
    kind: "source_credential",
    tenantId: T.acme,
    name: "u-src",
    value: V.srcAcme,
  });
  if (
    await seedSecret(owner, {
      id: S.broken,
      kind: "provider_api_key",
      tenantId: null,
      name: "u-broken",
      value: V.broken,
    })
  )
    await owner`update hub.secrets set ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 1) where id = ${S.broken}`;
}, 60_000);
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

async function reader(key: typeof HUB_KEY | null = HUB_KEY) {
  const m = await loadUse();
  expect(typeof m.HubSecretReader).toBe("function");
  return new m.HubSecretReader({ db, key, log: mkLog() });
}
/** Kết quả `useSecret`: giá trị fn nhận, hoặc lỗi {name, code, reason, failure, message}; `called` = fn có chạy. */
async function use(
  ref: { id: string; kind: string; tenantId: string | null },
  key: typeof HUB_KEY | null = HUB_KEY,
) {
  const r = await reader(key);
  let called = false;
  try {
    const out = await r.useSecret(ref, async (v: string) => {
      called = true;
      return v;
    });
    return { out, called };
  } catch (e) {
    const x = e as {
      name?: string;
      code?: string;
      reason?: string;
      failure?: string;
      message?: string;
    };
    return {
      err: { code: x.code, reason: x.reason, failure: x.failure, message: x.message },
      called,
    };
  }
}
const fail = (failure: string) => ({
  err: { code: "NOT_CONFIGURED", reason: "credential", failure, message: `hub secret: ${failure}` },
  called: false,
});

describe("A80–A82 · giải đúng ref [plan §2.3]", () => {
  it("HUB-FR-68 · A80 · provider (tenant null) ⇒ fn nhận đúng bản rõ, useSecret trả kết quả của fn", async () => {
    expect(await use({ id: S.prov, kind: "provider_api_key", tenantId: null })).toEqual({
      out: V.prov,
      called: true,
    });
  });
  it("HUB-FR-68 · Q7 · CR-060 · A81 · kh_api_key acme + source_credential acme với tenant đúng ⇒ đúng bản rõ", async () => {
    expect([
      await use({ id: S.khAcme, kind: "kh_api_key", tenantId: T.acme }),
      await use({ id: S.srcAcme, kind: "source_credential", tenantId: T.acme }),
    ]).toEqual([
      { out: V.khAcme, called: true },
      { out: V.srcAcme, called: true },
    ]);
  });
  it("HUB-FR-68 · D12 · A82 · không cache: đổi bản mã (owner, cùng AAD) ⇒ lần dùng kế nhận giá trị mới", async () => {
    expect((await use({ id: S.prov, kind: "provider_api_key", tenantId: null })).out).toBe(V.prov);
    const nv = val("u-prov-2");
    const s = specSeal(nv, { id: S.prov, kind: "provider_api_key", tenantId: null });
    await owner`update hub.secrets set ciphertext = ${s.ciphertext}, iv = ${s.iv} where id = ${S.prov}`;
    expect((await use({ id: S.prov, kind: "provider_api_key", tenantId: null })).out).toBe(nv);
    V.prov = nv;
  });
});

describe("A83–A86 · lỗi ⇒ SecretUseError, fn không chạy [HUB-BR-30 · HUB-BR-15]", () => {
  it("HUB-BR-15 · AC-H4b1-05 · A83 · source acme với ref tenant beta / tenant null ⇒ secret_missing (không mở chéo tenant)", async () => {
    expect([
      await use({ id: S.srcAcme, kind: "source_credential", tenantId: T.beta }),
      await use({ id: S.srcAcme, kind: "source_credential", tenantId: null }),
    ]).toEqual([fail("secret_missing"), fail("secret_missing")]);
  });
  it("HUB-FR-68 · A84 · kind sai / id không tồn tại ⇒ secret_missing", async () => {
    expect([
      await use({ id: S.khAcme, kind: "source_credential", tenantId: T.acme }),
      await use({
        id: "a4b10000-0000-4000-8000-000000000996",
        kind: "provider_api_key",
        tenantId: null,
      }),
    ]).toEqual([fail("secret_missing"), fail("secret_missing")]);
  });
  it("HUB-FR-68 · AC-H4b1-02 · A85 · bản mã sửa 1 byte ⇒ decrypt_failed", async () => {
    expect(await use({ id: S.broken, kind: "provider_api_key", tenantId: null })).toEqual(
      fail("decrypt_failed"),
    );
  });
  it("HUB-FR-68 · A86 · khoá vắng (key null) ⇒ key_missing; khoá khác ⇒ decrypt_failed", async () => {
    expect(await use({ id: S.khAcme, kind: "kh_api_key", tenantId: T.acme }, null)).toEqual(
      fail("key_missing"),
    );
    const other = {
      version: 1,
      key: Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff),
    };
    expect(await use({ id: S.khAcme, kind: "kh_api_key", tenantId: T.acme }, other)).toEqual(
      fail("decrypt_failed"),
    );
  });
});

describe("A87–A88 · không lộ [AC-H4b1-07 · HUB-BR-30 · Q12]", () => {
  it("HUB-BR-30 · AC-H4b1-07 · A87 · log của reader: lỗi ⇒ warn có {secret_id, kind, failure}; không dòng nào chứa bản rõ / id trong message lỗi", async () => {
    await use({ id: S.srcAcme, kind: "source_credential", tenantId: T.beta });
    const warns = logs
      .map((l) => JSON.parse(l))
      .filter((l) => l.level === "warn" && l.failure === "secret_missing");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.at(-1)).toMatchObject({
      secret_id: S.srcAcme,
      kind: "source_credential",
      failure: "secret_missing",
    });
    expect(logs.length).toBeGreaterThan(0);
    expectNoValue(logs.join("\n"), Object.values(V));
  });
  it("HUB-BR-30 · AC-H4b1-07 · Q12 · A88 · useSecret (thành công + lỗi) không ghi hub.jobs / run_steps / audit_log / config_meta; không bảng hub.* nào chứa bản rõ", async () => {
    const counts = async () => {
      const [r] = await owner`select (select count(*) from hub.jobs)::int as jobs,
        (select count(*) from hub.run_steps)::int as steps, (select count(*) from hub.audit_log)::int as audit,
        (select hub_config_version from hub.config_meta where id = 1) as v`;
      return { ...r };
    };
    const c0 = await counts();
    await use({ id: S.prov, kind: "provider_api_key", tenantId: null });
    await use({ id: S.broken, kind: "provider_api_key", tenantId: null });
    expect(await counts()).toEqual(c0);
    const tables = await owner<
      { t: string }[]
    >`select table_name as t from information_schema.tables
      where table_schema = 'hub' and table_type = 'BASE TABLE' order by 1`;
    const hits: string[] = [];
    for (const { t } of tables)
      for (const v of Object.values(V)) {
        const [r] = await owner.unsafe(
          `select count(*)::int as n from hub."${t}" x where x::text like '%' || $1 || '%'`,
          [v],
        );
        if ((r?.n ?? 0) > 0) hits.push(`${t}:${v}`);
      }
    expect(hits).toEqual([]);
  });
});
