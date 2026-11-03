// CR-116 · cr116-bench-apps · Luật 4c: A/B TRỰC TIẾP `compileRoles` (CR-112) — CHỈ ĐO, không đổi hành vi.
// A = mã hiện tại (khoá vai FOR UPDATE · DELETE … USING jsonb · INSERT … ON CONFLICT DO NOTHING = 3 câu cho mọi vai);
// B = "từng vai" (gọi `compileRoles` một vai mỗi lần, 3 câu × N); C = như A nhưng câu chèn là PG `MERGE … WHEN NOT MATCHED`
// (PG16: chưa có `WHEN NOT MATCHED BY SOURCE`/`RETURNING` ⇒ không gộp được câu xoá). Cùng dữ liệu: N vai gói `contracts` (mức xoay
// vòng), Group của vai chưa có grant ⇒ mỗi lượt chèn đủ; mỗi lượt đo trong tx ROLLBACK. 3 tiêu chí: (1) tin cậy — trạng thái grant
// cuối BẰNG nhau; 2 tx đồng thời (commit thật) không lỗi/không trùng; tx bị cắt kết nối giữa chừng ⇒ không để lại gì, chạy lại ra
// đúng trạng thái; (2) tài nguyên — số câu SQL, 1 kết nối; (3) p50/p95. Cỡ: 10 vai (prod) và 1.000 vai.
// Chạy: `powershell deploy/evotest/run-tests.ps1 -Step perf -Exclusive -Filter <file này>`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { enablePack, groups, tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql, latencyStats } from "@ai/test-kit/perf";
import { sql as dsql } from "drizzle-orm";
import { compileRoles } from "./app-roles.compile";
import { type CompileRole, compilePlan } from "./app-roles.rules";

const N = Number(process.env.CR116_N ?? 30);
const ROUNDS = 3;
let sql: Sql;
let db: Db;
type Ten = { id: string; n: number; roles: string[] };
const T: Ten[] = [];

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(4);
  const ids = (await tenants(sql, 2, 1701)) as [string, string];
  await enablePack(sql, ids, "contracts");
  for (const [i, n] of [10, 1000].entries()) {
    const t = ids[i] as string;
    const keys = Array.from({ length: n }, (_, k) => `cr116-r${k}`);
    await groups(sql, t, keys);
    const out = await sql<
      { id: string }[]
    >`insert into admin.app_roles (tenant_id, pack, key, name, level, group_id)
      select ${t}::uuid, 'contracts', k.k, jsonb_build_object('vi', k.k), (array['read','write','admin'])[(k.i % 3) + 1], g.id
      from unnest(${sql.array(keys)}::text[]) with ordinality k(k, i)
      join admin.groups g on g.tenant_id = ${t}::uuid and g.key = k.k
      returning id`;
    T.push({ id: t, n, roles: out.map((r) => r.id) });
  }
  await sql`analyze admin.app_roles, admin.feature_grants, admin.groups`;
  db = createDb(urls().owner, { max: 4 });
}, 300_000);

afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

/** C · như `compileRoles` nhưng chèn bằng MERGE (cùng khoá + cùng câu xoá). */
async function compileMerge(tx: Tx, tenantId: string): Promise<void> {
  const roles = (await tx.execute(dsql`select group_id, pack, level from admin.app_roles
    where tenant_id = ${tenantId}::uuid order by id for update`)) as unknown as CompileRole[];
  const plan = compilePlan(roles);
  await tx.execute(dsql`delete from admin.feature_grants fg
    using jsonb_to_recordset(${JSON.stringify(plan.drop)}::jsonb) as d(g uuid, f text), admin.features f
    where fg.tenant_id = ${tenantId}::uuid and fg.group_id = d.g and f.key = d.f and fg.feature_id = f.id`);
  await tx.execute(dsql`merge into admin.feature_grants fg
    using (select f.id as fid, w.g from jsonb_to_recordset(${JSON.stringify(plan.want)}::jsonb) as w(g uuid, f text)
      join admin.features f on f.key = w.f) s
    on fg.tenant_id = ${tenantId}::uuid and fg.feature_id = s.fid and fg.group_id = s.g
    when not matched then insert (tenant_id, feature_id, group_id, granted_by)
      values (${tenantId}::uuid, s.fid, s.g, null)`);
}

type Fn = (tx: Tx) => Promise<unknown>;
const variants = (t: Ten): { label: string; f: Fn }[] => [
  {
    label: "A set-based ON CONFLICT (hiện tại)",
    f: (tx) => compileRoles(tx, { tenantId: t.id, roleIds: null, actorId: null }),
  },
  {
    label: "B từng vai",
    f: async (tx) => {
      for (const id of t.roles)
        await compileRoles(tx, { tenantId: t.id, roleIds: [id], actorId: null });
    },
  },
  { label: "C set-based MERGE", f: (tx) => compileMerge(tx, t.id) },
];

const stateOf = async (x: Sql | Tx, tid: string): Promise<string> => {
  const q = dsql`select coalesce(string_agg(fg.group_id::text || '/' || f.key, ',' order by fg.group_id, f.key), '') as s
    from admin.feature_grants fg join admin.features f on f.id = fg.feature_id
    join admin.app_roles r on r.group_id = fg.group_id and r.tenant_id = fg.tenant_id where r.tenant_id = ${tid}::uuid`;
  const rows = (await (x as Tx).execute(q)) as unknown as { s: string }[];
  return rows[0]?.s ?? "";
};
const reset = (tid: string) =>
  sql`delete from admin.feature_grants fg using admin.app_roles r
    where r.group_id = fg.group_id and r.tenant_id = fg.tenant_id and r.tenant_id = ${tid}::uuid`;

class Rollback extends Error {}
async function once(fn: Fn, tid: string): Promise<{ ms: number; key: string }> {
  let res = { ms: 0, key: "" };
  try {
    await db.db.transaction(async (tx) => {
      const t0 = performance.now();
      await fn(tx);
      res = { ms: performance.now() - t0, key: await stateOf(tx, tid) };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return res;
}

/** Tin cậy: 2 tx đồng thời (commit) + cắt kết nối giữa tx rồi chạy lại. Trả "✓" hoặc mô tả lỗi. */
async function reliability(t: Ten, fn: Fn, want: string): Promise<string> {
  await reset(t.id);
  const conc = await Promise.allSettled([db.db.transaction(fn), db.db.transaction(fn)]);
  const errs = conc.filter((r) => r.status === "rejected").length;
  const s1 = await stateOf(db.db as unknown as Tx, t.id);
  await reset(t.id);
  let killed = false;
  try {
    await db.db.transaction(async (tx) => {
      await fn(tx);
      // Lỗi giữa tx sau khi đã xoá/chèn (pg_terminate_backend làm postgres.js 3.4.9 crash `socket.write` ⇒ dùng lỗi câu lệnh).
      await tx.execute(dsql`select 1 / 0`);
    });
  } catch {
    killed = true;
  }
  const s2 = await stateOf(db.db as unknown as Tx, t.id);
  await db.db.transaction(fn);
  const s3 = await stateOf(db.db as unknown as Tx, t.id);
  await reset(t.id);
  const ok = errs === 0 && s1 === want && killed && s2 === "" && s3 === want;
  return ok
    ? "✓"
    : `✗ errs=${errs} conc=${s1 === want} killed=${killed} left=${s2.length} rerun=${s3 === want}`;
}

async function benchTenant(t: Ten): Promise<boolean> {
  const vs = variants(t);
  const client = (db.db as unknown as { $client: Sql }).$client;
  const n = t.n > 100 ? Math.max(5, Math.floor(N / 3)) : N;
  const ms = vs.map(() => [] as number[]);
  const keys = vs.map(() => "");
  const counts: number[] = [];
  for (const v of vs) counts.push((await captureSql(client, () => once(v.f, t.id))).queries.length);
  for (let r = 0; r < ROUNDS; r++)
    for (const [i, v] of vs.entries()) {
      await once(v.f, t.id); // nóng
      for (let k = 0; k < n; k++) {
        const o = await once(v.f, t.id);
        ms[i]?.push(o.ms);
        keys[i] = o.key;
      }
    }
  let ok = (keys[0] as string).length > 0;
  for (const [i, v] of vs.entries()) {
    const st = latencyStats(ms[i] as number[]);
    const eq = keys[i] === keys[0];
    const rel = await reliability(t, v.f, keys[0] as string);
    ok = ok && eq && rel === "✓";
    console.log(
      `CR116|C4 compileRoles|${v.label}|${t.n} vai|${st.p50.toFixed(2)}|${st.p95.toFixed(2)}|${(counts[i] as number) - 1}|${eq ? "✓" : "✗"}|${rel}|conn=1|mean=${((ms[i] as number[]).reduce((a, b) => a + b, 0) / (ms[i] as number[]).length).toFixed(2)}`,
    );
  }
  return ok;
}

describe("CR-116 · A/B compileRoles", () => {
  it("set-based ON CONFLICT vs từng vai vs MERGE", async () => {
    let ok = true;
    for (const t of T) ok = (await benchTenant(t)) && ok;
    expect(ok).toBe(true);
  }, 900_000);
});
