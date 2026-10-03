// ADM-FR-51 · M4-R12 · BR-09 · AC-A09 · GET /admin/audit, /admin/audit/:id (test-plan AR1–AR7; M4-AC07, M4-AC12).
// audit_log tích luỹ giữa các lần chạy (không xoá được) → dữ liệu mỗi ca mang tiền tố `ar-{mark}-`, lọc `q` theo tiền tố.
// Xanh ở T2.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  createM4Env,
  expectErr4,
  ID,
  id4,
  type M4Env,
  parse4,
  resetNow,
  seedAuditRows,
  TENANT_ID,
  userIdOf,
} from "./_ab";

let env: M4Env;
let P = "";
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
  P = `ar-${await auditMark(env.owner)}-`;
  await seedAuditRows(env.owner, 6, { prefix: `${P}a`, tenantId: A });
  await seedAuditRows(env.owner, 3, { prefix: `${P}g`, tenantId: G });
  await seedAuditRows(env.owner, 3, { prefix: `${P}n`, tenantId: null });
});

type Item = { id: string; tenant_id: string | null; restorable: boolean; entity_name: string };
const list = async (q: string, who: "admin" | "binh" | "an" = "admin") => {
  const call = who === "admin" ? env.by("platform", "admin") : env.by("acme", who);
  return call("GET", `/admin/audit?${q}`);
};
const items = (res: { json: { items: Item[] } }) => {
  for (const i of res.json.items) parse4("AuditItemSchema", i);
  return res.json.items;
};
const idByName = async (name: string) => {
  const [r] =
    await env.owner`select id, seq::text as seq from admin.audit_log where entity_name = ${name}`;
  return r as { id: string; seq: string };
};

describe("ADM-FR-51 · M4-R12 · phạm vi đọc", () => {
  it("ADM-FR-51 · M4-R12 · M4-AC07 · AR1 · binh không tenant_id → chỉ 6 dòng acme; mọi item restorable false", async () => {
    const res = await list(`q=${P}`, "binh");
    expect(res.status).toBe(200);
    const it6 = items(res);
    expect(it6).toHaveLength(6);
    expect(it6.every((i) => i.tenant_id === A && i.restorable === false)).toBe(true);
  });

  it("ADM-BR-09 · AC-A09 · AR2 · binh tenant_id=globex / system → 404; GET /audit/:id dòng globex / NULL → 404", async () => {
    expectErr4(await list(`tenant_id=${G}`, "binh"), "NOT_FOUND");
    expectErr4(await list("tenant_id=system", "binh"), "NOT_FOUND");
    const binh = env.by("acme", "binh");
    for (const n of [`${P}g01`, `${P}n01`]) {
      const r = await binh("GET", `/admin/audit/${(await idByName(n)).id}`);
      expect([n, r.status]).toEqual([n, 404]);
    }
    expect((await binh("GET", `/admin/audit/${(await idByName(`${P}a01`)).id}`)).status).toBe(200);
  });

  it("ADM-FR-51 · M4-R12 · AR3 · admin: không lọc → 12; system → 3 (tenant_id null); acme → 6", async () => {
    expect(items(await list(`q=${P}`))).toHaveLength(12);
    const sys = items(await list(`q=${P}&tenant_id=system`));
    expect(sys.map((i) => i.tenant_id)).toEqual([null, null, null]);
    expect(items(await list(`q=${P}&tenant_id=${A}`))).toHaveLength(6);
  });

  it("ADM-FR-51 · M4-R12 · AR4 · limit 5: trang 5/5/2, next_cursor cuối null; không trùng, seq giảm liên tục; cursor '!!' → 400", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res = await list(
        `q=${P}&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(res.status).toBe(200);
      sizes.push(res.json.items.length);
      seen.push(...items(res).map((i) => i.entity_name));
      cursor = res.json.next_cursor;
    } while (cursor && sizes.length < 5);
    expect(sizes).toEqual([5, 5, 2]);
    expect(new Set(seen).size).toBe(12);
    const seqs = await Promise.all(seen.map(async (n) => BigInt((await idByName(n)).seq)));
    for (let i = 1; i < seqs.length; i++) expect((seqs[i] ?? 0n) < (seqs[i - 1] ?? 0n)).toBe(true);
    expectErr4(await list("cursor=!!"), "VALIDATION_ERROR");
  });

  it("ADM-FR-51 · M4-R12 · AR5 · lọc entity, action, actor_id, entity_id, q, from/to (dòng 31 ngày trước chỉ hiện khi lùi from)", async () => {
    const binhId = await userIdOf(env, "binh", "acme");
    const E = id4(60);
    const o = env.owner;
    await o`insert into admin.audit_log (tenant_id, actor_id, action, entity, entity_id, entity_name, summary)
      values (${A}, ${binhId}, 'delete', 'command', ${E}, ${`${P}x01`}, ${o.json({})})`;
    await o`insert into admin.audit_log (tenant_id, action, entity, entity_name, summary, at)
      values (${A}, 'lock', 'user', ${`${P}old`}, ${o.json({})}, now() - interval '31 days')`;
    const names = async (q: string) => items(await list(`q=${P}&${q}`)).map((i) => i.entity_name);
    expect(await names("entity=command")).toEqual([`${P}x01`]);
    expect(await names("action=delete")).toEqual([`${P}x01`]);
    expect(await names(`actor_id=${binhId}`)).toEqual([`${P}x01`]);
    expect(await names(`entity_id=${E}`)).toEqual([`${P}x01`]);
    expect(items(await list(`q=${P}g`))).toHaveLength(3);
    expect(await names("action=lock")).toEqual([]);
    const d = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    expect(await names(`action=lock&from=${d}&to=${today}`)).toEqual([`${P}old`]);
  });

  it("ADM-FR-51 · AR6 · detail parse strict (before/after, summary, tenant_key); admin restorable = canRestore (update command true, lock user false)", async () => {
    const o = env.owner;
    const cmd = ID.command.dich;
    const before = { name: "dich", description: { vi: "A" }, version: 3 };
    await o`insert into admin.audit_log (tenant_id, action, entity, entity_id, entity_name, entity_version, before, after, summary, snapshot)
      values (null, 'update', 'command', ${cmd}, ${`${P}cmd`}, 4, ${o.json(before)}, ${o.json({ ...before, version: 4 })}, ${o.json({})}, true)`;
    await o`insert into admin.audit_log (tenant_id, action, entity, entity_id, entity_name, summary)
      values (${A}, 'lock', 'user', ${id4(61)}, ${`${P}lock`}, ${o.json({})})`;
    const admin = env.by("platform", "admin");
    const c = await admin("GET", `/admin/audit/${(await idByName(`${P}cmd`)).id}`);
    expect(c.status).toBe(200);
    const dc = parse4("AuditDetailSchema", c.json);
    expect([dc.restorable, dc.before, dc.tenant_key]).toEqual([true, before, null]);
    const l = await admin("GET", `/admin/audit/${(await idByName(`${P}lock`)).id}`);
    const dl = parse4("AuditDetailSchema", l.json);
    expect([dl.restorable, dl.tenant_key, dl.before, dl.after]).toEqual([
      false,
      "acme",
      null,
      null,
    ]);
  });

  it("ADM-BR-09 · M4-AC12 · AR7 · an GET /audit, /audit/:id → 403; limit 201 → 400", async () => {
    expectErr4(await list("", "an"), "FORBIDDEN");
    const an = env.by("acme", "an");
    expectErr4(await an("GET", `/admin/audit/${(await idByName(`${P}a01`)).id}`), "FORBIDDEN");
    expectErr4(await list("limit=201"), "VALIDATION_ERROR");
  });
});
