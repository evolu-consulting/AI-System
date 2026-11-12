// tool-tenant-purge · int: hai tenant có dữ liệu ở admin/hub/contracts/community/knowledge (+ audit append-only, file FileBox);
// chạy thử không xoá gì; platform bị từ chối; bảng lạ làm kế hoạch FAIL; xoá A ⇒ 0 hàng của A ở MỌI bảng tenant_id, B y nguyên,
// audit platform + config_version tăng, FileBox của A bị xoá (sau commit); chạy lại khi tenant đã mất ⇒ chỉ dọn file, không lỗi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contracts,
  department,
  enableAddon,
  enablePack,
  managers,
  tenants,
  users,
} from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { type PurgeDeps, runPurge } from "./tenant-purge";
import { readTables } from "./tenant-purge.db";
import type { FileStore } from "./tenant-purge.files";
import { parsePurgeArgs, qRel } from "./tenant-purge.rules";

let sql: Sql;
let dir: string;
let A = "";
let B = "";
const NAME_A = "Tenant 7101";

/** FileBox giả: org ⇒ id; ghi lại id đã xoá. */
function fakeStore(): FileStore & { files: Map<string, string>; removed: string[] } {
  const files = new Map<string, string>(); // id -> org
  const removed: string[] = [];
  return {
    files,
    removed,
    async list(org) {
      return [...files].filter(([, o]) => o === org).map(([id]) => id);
    },
    async remove(id) {
      removed.push(id);
      return files.delete(id) ? "deleted" : "missing";
    },
  };
}
let store: ReturnType<typeof fakeStore>;
const deps = (): PurgeDeps => ({
  files: store,
  log: () => {},
  operator: "int-test",
  statePath: (id) => join(dir, `${id}.json`),
});

async function seedTenant(t: string, n: number): Promise<void> {
  const [u1, u2, u3] = (await users(sql, t, 3, { from: n, role: "tenant_admin" })) as [
    string,
    string,
    string,
  ];
  await department(sql, t, `phong-${n}`, { head: u1, members: [u2, u3] });
  await managers(sql, t, [[u2, u1]]);
  await contracts(sql, t, 2, { from: n, createdBy: u1, owner: u2 });
  await sql`insert into admin.audit_log (tenant_id, actor_id, action, entity, entity_name, summary)
    values (${t}::uuid, ${u1}::uuid, 'create', 'user', 'u', '{}'::jsonb)`;
  const [c] = await sql<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${t}::uuid, ${u1}::uuid, 'Hội thoại', 'hoi thoai') returning id`;
  await sql`insert into hub.notifications (tenant_id, user_id, source, kind, title, dedup_key)
    values (${t}::uuid, ${u2}::uuid, 'test', 'info', 'Chuông', ${`k-${n}`})`;
  const att = crypto.randomUUID();
  await sql`insert into hub.attachments (id, tenant_id, user_id, origin, conversation_id, filename, safe_name, mime, size,
      sha256, storage_key, filebox_file_id)
    values (${att}::uuid, ${t}::uuid, ${u1}::uuid, 'upload', ${c?.id as string}::uuid, 'a.pdf', 'a.pdf', 'application/pdf', 1,
      ${"a".repeat(64)}, ${`${t}/${att}`}, ${`fb-att-${n}`})`;
  await sql`insert into community.settings (tenant_id, user_id) values (${t}::uuid, ${u1}::uuid)`;
  await sql`insert into knowledge.documents (tenant_id, title, content_hash) values (${t}::uuid, 'Tài liệu', ${String(n).padStart(64, "0")})`;
  store.files.set(`fb-att-${n}`, "hub-org");
  store.files.set(`fb-pack-${n}`, `t_${t}`);
}

/** Đếm hàng theo bảng `tenant_id` cho một tenant (mọi schema, quét catalog thật). */
async function snapshot(t: string): Promise<Record<string, number>> {
  const rel = (await readTables(sql)).filter((x) => x.tenantType === "uuid").map((x) => x.rel);
  const parts = rel.map(
    (r, i) => `select ${i} as i, count(*)::int as n from ${qRel(r)} where tenant_id = $1::uuid`,
  );
  const rows = (await sql.unsafe(parts.join(" union all "), [t])) as unknown as {
    i: number;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [rel[r.i] as string, r.n]));
}
const nonZero = (s: Record<string, number>) =>
  Object.fromEntries(Object.entries(s).filter(([, n]) => n > 0));

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(3);
  dir = mkdtempSync(join(tmpdir(), "tenant-purge-"));
  store = fakeStore();
  [A, B] = (await tenants(sql, 2, 7101)) as [string, string];
  await enablePack(sql, [A, B], "contracts");
  await enableAddon(sql, [A, B], "contracts-community"); // ADR-0044: Bảng tin = add-on của contracts
  await seedTenant(A, 7101);
  await seedTenant(B, 7201);
});
afterAll(async () => {
  await sql.end();
  rmSync(dir, { recursive: true, force: true });
});

describe("tool-tenant-purge", () => {
  it("chạy thử: in số hàng theo bảng, không xoá gì (DB + FileBox)", async () => {
    const before = await snapshot(A);
    const r = await runPurge(sql, parsePurgeArgs(["--tenant", NAME_A]), deps());
    expect(r.kind).toBe("dry");
    if (r.kind !== "dry") return;
    expect(r.counts["admin.users"]).toBe(3);
    expect(r.counts["hub.conversations"]).toBe(1);
    expect(r.counts["admin.audit_log"]).toBe(1);
    expect(r.counts["admin.tenants"]).toBe(1);
    expect(r.fileIds).toContain("fb-att-7101");
    expect(await snapshot(A)).toEqual(before);
    expect(store.removed).toEqual([]);
  });

  it("từ chối tenant platform và --confirm sai", async () => {
    await sql`insert into admin.tenants (key, name) values ('platform', 'Nền tảng') on conflict (key) do nothing`;
    await expect(runPurge(sql, parsePurgeArgs(["--tenant", "platform"]), deps())).rejects.toThrow(
      /platform/,
    );
    const bad = parsePurgeArgs(["--tenant", A, "--apply", "--confirm", "tenant 7101"]);
    await expect(runPurge(sql, bad, deps())).rejects.toThrow(/--confirm/);
    expect(nonZero(await snapshot(A))["admin.users"]).toBe(3);
  });

  it("bảng lạ tham chiếu dữ liệu tenant (FK hoặc cột *tenant*) ⇒ kế hoạch FAIL", async () => {
    await sql.unsafe(
      "create table public.zz_purge_probe (id serial primary key, who uuid references admin.users (id))",
    );
    try {
      await expect(runPurge(sql, parsePurgeArgs(["--tenant", A]), deps())).rejects.toThrow(
        /zz_purge_probe/,
      );
    } finally {
      await sql.unsafe("drop table public.zz_purge_probe");
    }
    await sql.unsafe(
      "create table public.zz_purge_probe2 (id serial primary key, owner_tenant uuid)",
    );
    try {
      await expect(runPurge(sql, parsePurgeArgs(["--tenant", A]), deps())).rejects.toThrow(
        /zz_purge_probe2/,
      );
    } finally {
      await sql.unsafe("drop table public.zz_purge_probe2");
    }
  });

  it("--apply: A còn 0 hàng ở mọi bảng tenant_id, B y nguyên, audit platform + config_version tăng, FileBox của A bị xoá", async () => {
    const beforeB = await snapshot(B);
    const [v0] = await sql<
      { v: number }[]
    >`select config_version as v from admin.config_meta where id = 1`;
    const a = parsePurgeArgs(["--tenant", A, "--apply", "--confirm", NAME_A]);
    const r = await runPurge(sql, a, deps());
    expect(r.kind).toBe("applied");
    expect(nonZero(await snapshot(A))).toEqual({});
    expect(await snapshot(B)).toEqual(beforeB);
    expect((await sql`select 1 from admin.tenants where id = ${A}::uuid`).length).toBe(0);
    const [au] = await sql<{ n: number; total: number }[]>`select count(*)::int as n,
        max((summary ->> 'rows_total')::int) as total from admin.audit_log
      where tenant_id is null and entity = 'tenant' and action = 'delete' and entity_id = ${A}::uuid
        and summary ->> 'operator' = 'int-test'`;
    expect(au?.n).toBe(1);
    expect(au?.total).toBeGreaterThan(10);
    const [v1] = await sql<
      { v: number }[]
    >`select config_version as v from admin.config_meta where id = 1`;
    expect(v1?.v).toBeGreaterThan(v0?.v ?? 0);
    expect(store.removed.sort()).toEqual(["fb-att-7101", "fb-pack-7101"]);
    expect([...store.files.keys()].sort()).toEqual(["fb-att-7201", "fb-pack-7201"]);
    expect(r.files?.leftovers).toEqual([]);
  });

  it("chạy lại khi tenant đã mất ⇒ chỉ dọn FileBox (idempotent), không lỗi", async () => {
    store.files.set("fb-late", `t_${A}`);
    const a = parsePurgeArgs(["--tenant", A, "--apply", "--confirm", NAME_A]);
    const r = await runPurge(sql, a, deps());
    expect(r.kind).toBe("gone");
    expect(r.files?.leftovers).toEqual([]);
    expect(store.files.has("fb-late")).toBe(false);
    expect([...store.files.keys()].sort()).toEqual(["fb-att-7201", "fb-pack-7201"]);
  });
});
