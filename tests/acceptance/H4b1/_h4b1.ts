// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · HUB-BR-30 · hạ tầng int H4b-1 (test-plan H4b1 §2): DB sạch H3b (acme/beta/platform,
// `tadmin` acme, `badmin` beta, `lan` member) + hub-api thật với seam `AppDeps.hubSecretsKey` (plan D11) + bắt log
// (`setSink` logger Hub + console). Mã hoá đối chứng ĐỘC LẬP theo spec Q2/plan D3 (AES-256-GCM, AAD
// `hub.secrets:<id>:<kind>:<tenant|->:<key_version>`) để kiểm bản mã sản phẩm và dựng secret bằng owner.
// Không import module chưa có (nạp động) ⇒ `bun run typecheck` xanh trước code. Không chứa `it(...)`.
import { expect } from "bun:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
import {
  call,
  type Json,
  type Keys,
  makeKeys,
  type Res,
  type Sql,
  T,
  USERS,
} from "../H1/_fixtures";
import type { HubX } from "../H1/_hub";
import {
  auditMax,
  auditSince,
  BADMIN,
  errOf,
  failingAudit,
  type HubAuditLike,
  setupH3b,
  startHubH3b,
  tok,
  versionOf,
  type Who,
} from "../H3b/_h3b";
import { type Loose, ROOT } from "../M1/_modules";

export {
  auditMax,
  auditSince,
  BADMIN,
  errOf,
  failingAudit,
  type Json,
  type Res,
  type Sql,
  T,
  USERS,
  versionOf,
  type Who,
};

// ---------- id cố định (dải `a4b1…`) ----------
const h = (n: number) => `a4b10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định (mỗi file một dải `base` ≥ 1000). */
export function idGen(base: number): () => string {
  let n = base;
  return () => h(n++);
}
export const NONE = h(999);
export const KINDS = ["provider_api_key", "kh_api_key", "source_credential"] as const;
export type Kind = (typeof KINDS)[number];

// ---------- khoá cố định (spec §7, Q6: test dùng khoá cố định trong fixture) ----------
export const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
export const KEY_B64 = Buffer.from(KEY_BYTES).toString("base64");
/** `SecretKey` (plan §2.2) truyền vào `AppDeps.hubSecretsKey`. */
export const HUB_KEY = { version: 1, key: KEY_BYTES };
export const OTHER_KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff);

/** Giá trị secret dễ nhận khi rò (≥ 8 ký tự, duy nhất theo `tag`). */
export const val = (tag: string) => `sk-qc-H4B1-${tag}-Zx9Pq7Lm`;

// ---------- mã hoá đối chứng theo spec (không dùng code sản phẩm) ----------
export type Meta = { id: string; kind: string; tenantId: string | null };
export const specAad = (m: Meta, kv = 1): Buffer =>
  Buffer.from(`hub.secrets:${m.id}:${m.kind}:${m.tenantId ?? "-"}:${kv}`, "utf8");
export function specSeal(
  value: string,
  m: Meta,
  kv = 1,
  key: Uint8Array = KEY_BYTES,
): { ciphertext: Buffer; iv: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(specAad(m, kv));
  const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return { ciphertext: Buffer.concat([ct, c.getAuthTag()]), iv };
}
/** Giải theo spec; sai ⇒ ném. */
export function specOpen(ciphertext: Uint8Array, iv: Uint8Array, m: Meta, kv = 1): string {
  const buf = Buffer.from(ciphertext);
  const d = createDecipheriv("aes-256-gcm", KEY_BYTES, Buffer.from(iv));
  d.setAAD(specAad(m, kv));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8");
}

// ---------- DB (owner) ----------
export async function tableExists(sql: Sql, name = "hub.secrets"): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select to_regclass(${name}) is not null as ok`;
  return !!r?.ok;
}
/** Chèn secret bằng owner (bản mã đối chứng). Bảng chưa có ⇒ trả false (ca đỏ ở expect, không PostgresError). */
export async function seedSecret(
  sql: Sql,
  o: Meta & { name: string; value: string; kv?: number },
): Promise<boolean> {
  if (!(await tableExists(sql))) return false;
  const s = specSeal(o.value, o, o.kv ?? 1);
  await sql`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
    values (${o.id}, ${o.kind}, ${o.tenantId}, ${o.name}, ${s.ciphertext}, ${s.iv}, ${o.kv ?? 1})`;
  return true;
}
export async function secretRow(sql: Sql, id: string): Promise<Json | undefined> {
  if (!(await tableExists(sql))) return undefined;
  const [r] = await sql`select * from hub.secrets where id = ${id}`;
  return r ? { ...r } : undefined;
}
export async function countByName(sql: Sql, name: string): Promise<number> {
  if (!(await tableExists(sql))) return -1;
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.secrets
    where lower(name) = lower(${name})`;
  return r?.n ?? -1;
}
/** "0 ghi": hàng secrets (kể cả iv/bản mã) + `hub_config_version` + max audit seq. */
export async function stateOf(sql: Sql): Promise<Json> {
  const rows = (await tableExists(sql))
    ? await sql`select id, kind, tenant_id, name, version, encode(iv, 'hex') as iv,
        encode(ciphertext, 'hex') as ct from hub.secrets order by id`
    : [];
  return {
    rows: rows.map((r) => ({ ...r })),
    version: await versionOf(sql),
    audit: await auditMax(sql),
  };
}

// ---------- hub-api thật ----------
export type H4b1Extra = { hubSecretsKey?: typeof HUB_KEY | null; hubAudit?: HubAuditLike };
export type Ctx = { sql: Sql; k: Keys; hub: HubX; stop: () => Promise<void> };
export async function startH4b1(extra: H4b1Extra = { hubSecretsKey: HUB_KEY }): Promise<Ctx> {
  const sql = await setupH3b();
  const k = await makeKeys();
  const hub = await startHubH3b(k, { instanceId: "qc-hub-h4b1", ...extra } as never);
  return {
    sql,
    k,
    hub,
    stop: async () => {
      await hub.stop();
      await sql.end();
    },
  };
}
/** Hub thứ hai trên cùng DB (vd không khoá ⇒ NOT_CONFIGURED; audit tiêm lỗi). */
export const extraHub = (x: Ctx, extra: H4b1Extra): Promise<HubX> =>
  startHubH3b(x.k, { instanceId: "qc-hub-h4b1-b", ...extra } as never);

// ---------- gọi API ----------
export async function studio(
  x: Ctx,
  w: Who | null,
  method: string,
  path = "",
  body?: unknown,
  hub: HubX = x.hub,
): Promise<Res> {
  const token = w ? await tok(x.k, w) : undefined;
  return call(hub, method, `/studio/api/secrets${path}`, { token, body });
}
export async function tenantApi(
  x: Ctx,
  w: Who | null,
  method: string,
  path = "",
  body?: unknown,
): Promise<Res> {
  const token = w ? await tok(x.k, w) : undefined;
  return call(x.hub, method, `/admin/source-credentials${path}`, { token, body });
}
/** POST Studio; trả id (rỗng nếu không 201 — ca đã khẳng định 201 trước khi dùng). */
export async function create(
  x: Ctx,
  body: { kind: Kind; name: string; value: string; tenant_id?: string },
): Promise<Res> {
  return studio(x, "padmin", "POST", "", body);
}
export const idOf = (r: Res): string => (r.status === 201 && r.json?.id ? r.json.id : NONE);

// ---------- contract (nạp động: `secrets.ts` chưa có trước T4) ----------
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");
export async function tryLoad(rel: string): Promise<Loose> {
  try {
    return await import(join(ROOT, rel));
  } catch {
    return {};
  }
}
export const loadCrypto = () => tryLoad("apps/hub-api/src/modules/secrets/secrets.crypto.ts");
export const loadUse = () => tryLoad("apps/hub-api/src/modules/secrets/secrets.use.ts");

/** Thân là `HubSecret` hợp contract (strict ⇒ không có value/ciphertext/iv/key_version/last4). */
export async function expectMeta(body: Json): Promise<void> {
  const c = await loadHubAdmin();
  expect(typeof c.HubSecretSchema?.safeParse).toBe("function");
  const p = c.HubSecretSchema.safeParse(body);
  expect(p.success ? "ok" : JSON.stringify(p.error?.issues)).toBe("ok");
  for (const f of ["value", "ciphertext", "iv", "key_version", "last4", "secret", "plaintext"])
    expect({ [f]: body?.[f] }).toEqual({ [f]: undefined });
}
/** Không chuỗi giá trị nào xuất hiện trong `text`. */
export function expectNoValue(text: string, values: readonly string[]): void {
  expect(values.filter((v) => text.includes(v))).toEqual([]);
}

// ---------- bắt log (AC-01, AC-07) ----------
export type LogCap = { lines: string[]; restore: () => void };
/** Bắt logger Hub (`setSink`, mức info+) + console.*; `restore` trả nguyên. */
export function captureAll(): LogCap {
  const lines: string[] = [];
  const restoreSink = setSink((_l, line) => lines.push(line));
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  const names = ["log", "info", "warn", "error", "debug"] as const;
  const orig = Object.fromEntries(names.map((n) => [n, c[n]]));
  for (const n of names) c[n] = (...a: unknown[]) => lines.push(a.map((v) => String(v)).join(" "));
  return {
    lines,
    restore: () => {
      restoreSink();
      Object.assign(c, orig);
    },
  };
}

// ---------- tham chiếu giả (spec §7: chèn bản ghi tham chiếu) ----------
export async function insertProvider(sql: Sql, id: string, key: string, secretId: string | null) {
  await sql`insert into hub.providers (id, key, kind, vendor, secret_id, max_concurrency, enabled, dev_only)
    values (${id}, ${key}, 'api', 'anthropic', ${secretId}, 1, true, false)`;
}
export async function insertSourceRef(
  sql: Sql,
  o: { id: string; tenant: string; key: string; secretId: string; deleted?: boolean },
) {
  const config = {
    kind: "git_remote",
    url: `https://example.test/${o.key}.git`,
    credential_secret_id: o.secretId,
  };
  await sql`insert into hub.sources (id, tenant_id, key, kind, config, deleted_at)
    values (${o.id}, ${o.tenant}, ${o.key}, 'git_remote', ${sql.json(config)},
      ${o.deleted ? sql`now()` : null})`;
}
