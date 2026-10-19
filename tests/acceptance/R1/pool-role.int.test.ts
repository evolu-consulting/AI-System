// R1 · pool + role riêng của module tri thức: đăng nhập `knowledge_api` (DSN `KNOWLEDGE_DATABASE_URL`) chỉ SET ROLE được
// `knowledge_rw`; KHÔNG đọc được `contracts.*` (cả trực tiếp lẫn qua SET ROLE gói khác), không SET ROLE `hub_api`; dịch vụ tri
// thức chạy đủ (thêm + tìm + lấy) trên pool này; `mountKnowledge` với `dsn` dựng pool riêng (không dùng pool chung).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import postgres from "postgres";
import {
  knowledgeDb,
  knowledgeService,
} from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const A = tenantId(981);
const U = userId(981);
let api: Sql;
let owner: Sql;
let db: Db;
let dsn = "";

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(1);
  dsn = withCreds(urls().owner, "knowledge_api", "knowledge_api_dev_pw");
  api = postgres(dsn, { max: 1, onnotice: () => {} });
  db = createDb(dsn, { max: 2 });
});
afterAll(async () => {
  await api?.end({ timeout: 2 });
  await db?.close();
  await owner?.end({ timeout: 2 });
});

describe("R1 · role knowledge_api", () => {
  it("thuộc tính role: LOGIN (dev), NOINHERIT, không superuser/bypassrls; chỉ là thành viên của knowledge_rw (SET, không INHERIT)", async () => {
    const [r] = await owner<{ inh: boolean; su: boolean; by: boolean }[]>`
      select rolinherit as inh, rolsuper as su, rolbypassrls as by from pg_roles where rolname = 'knowledge_api'`;
    expect(r).toEqual({ inh: false, su: false, by: false });
    const m = await owner<{ role: string; inh: boolean; set: boolean }[]>`
      select g.rolname as role, a.inherit_option as inh, a.set_option as set
      from pg_auth_members a join pg_roles g on g.oid = a.roleid join pg_roles u on u.oid = a.member
      where u.rolname = 'knowledge_api'`;
    expect([...m]).toEqual([{ role: "knowledge_rw", inh: false, set: true }]);
  });

  it("không đọc được contracts.* (trực tiếp, sau SET ROLE knowledge_rw) và không SET ROLE contracts_rw / hub_api", async () => {
    const tables = await owner<{ t: string }[]>`
      select tablename as t from pg_tables where schemaname = 'contracts' order by 1 limit 3`;
    expect(tables.length).toBeGreaterThan(0);
    for (const { t } of tables) {
      expect(await pgCode(() => api.unsafe(`select 1 from contracts.${t} limit 1`))).toBe("42501");
      expect(
        await pgCode(() =>
          api.begin(async (tx) => {
            await tx`select set_config('role', 'knowledge_rw', true)`;
            await tx.unsafe(`select 1 from contracts.${t} limit 1`);
          }),
        ),
      ).toBe("42501");
    }
    for (const role of ["contracts_rw", "hub_api"])
      expect(
        await pgCode(() => api.begin((tx) => tx`select set_config('role', ${role}, true)`)),
      ).toBe("42501");
  });

  it("không đọc bảng hub/admin (không join chéo schema)", async () => {
    const tables = await owner<{ s: string; t: string }[]>`
      select distinct on (schemaname) schemaname as s, tablename as t from pg_tables
      where schemaname in ('hub', 'admin') order by schemaname, tablename`;
    expect(tables.length).toBeGreaterThan(0);
    for (const { s, t } of tables)
      expect(await pgCode(() => api.unsafe(`select 1 from ${s}.${t} limit 1`))).toBe("42501");
  });

  it("dịch vụ tri thức chạy đủ trên pool knowledge_api: thêm + tìm + lấy", async () => {
    const svc = knowledgeService(db, {
      env: {},
      ai: { embedder: null, reranker: null },
      sources: [],
    });
    const who = { tenantId: A, userId: U };
    const add = await svc.add(who, {
      title: "Quy trình kho",
      content: "# Nhập kho\nHàng nhập kho Long An phải kiểm đếm trong 24 giờ.",
    });
    expect(add.ok).toBe(true);
    const s = await svc.search(who, { query: "kiểm đếm kho Long An", k: 3 });
    expect(s.ok && s.value.hits[0]?.body).toContain("24 giờ");
    const g = await svc.get(who, (s.ok && s.value.hits[0]?.chunkId) || "");
    expect(g.ok && g.value?.kind).toBe("chunk");
  });

  it("knowledgeDb: có dsn ⇒ pool MỚI (khác pool chung), đóng theo signal; vắng dsn ⇒ pool chung", async () => {
    const ctl = new AbortController();
    const own = knowledgeDb(dsn, {}, db, ctl.signal);
    expect(own).not.toBe(db);
    const [r] = (await own.db.execute("select current_user as u")) as unknown as { u: string }[];
    expect(r?.u).toBe("knowledge_api");
    ctl.abort();
    expect(knowledgeDb(undefined, {}, db)).toBe(db);
  });
});
