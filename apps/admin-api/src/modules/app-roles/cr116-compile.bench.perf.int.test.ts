// CR-116 · cr116-bench-apps · Luật 4c: A/B TRỰC TIẾP `compileRoles` (CR-112) — CHỈ ĐO, không đổi hành vi. A = mã hiện tại (3 câu
// cho mọi vai của tenant); B = phương án "từng vai" (gọi `compileRoles` với một vai mỗi lần, 3 câu × N). Cùng dữ liệu: N vai gói
// `contracts` (mức xoay vòng read/write/admin), Group của vai chưa có grant ⇒ mỗi lượt chèn đủ. Mỗi lượt trong tx ROLLBACK.
// So kết quả: tập (group, feature) được thêm phải bằng nhau. Cỡ: 10 vai (prod) và 1.000 vai.
// Chạy: `powershell deploy/evotest/run-tests.ps1 -Step perf -Exclusive -Filter <file này>`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { enablePack, groups, tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql, latencyStats } from "@ai/test-kit/perf";
import { type CompileResult, compileRoles } from "./app-roles.compile";

const N = Number(process.env.CR116_N ?? 30);
const ROUNDS = 3;
let sql: Sql;
let db: Db;
const T: { id: string; n: number; roles: string[] }[] = [];

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  const ids = (await tenants(sql, 2, 1701)) as [string, string];
  await enablePack(sql, ids, "contracts");
  for (const [i, n] of [10, 1000].entries()) {
    const t = ids[i] as string;
    const keys = Array.from({ length: n }, (_, k) => `cr116-r${k}`);
    const gm = await groups(sql, t, keys);
    const rows = keys.map((k, j) => ({
      tenant_id: t,
      pack: "contracts",
      key: k,
      name: JSON.stringify({ vi: k }),
      level: ["read", "write", "admin"][j % 3],
      group_id: gm.get(k) as string,
    }));
    const out = await sql<{ id: string }[]>`insert into admin.app_roles ${sql(rows)} returning id`;
    T.push({ id: t, n, roles: out.map((r) => r.id) });
  }
  await sql`analyze admin.app_roles, admin.feature_grants, admin.groups`;
  db = createDb(urls().owner, { max: 2 });
}, 300_000);

afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

class Rollback extends Error {}
async function once(
  fn: (tx: Tx) => Promise<CompileResult[]>,
): Promise<{ ms: number; key: string }> {
  let res = { ms: 0, key: "" };
  try {
    await db.db.transaction(async (tx) => {
      const t0 = performance.now();
      const rs = await fn(tx);
      const ms = performance.now() - t0;
      const key = rs
        .flatMap((r) => r.added.map((a) => `${a.group_id}/${a.feature_key}`))
        .sort()
        .join(",");
      res = { ms, key };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return res;
}

type V = { label: string; f: (tx: Tx) => Promise<CompileResult[]>; ms: number[]; key: string };
async function measureV(v: V, n: number): Promise<void> {
  await once(v.f); // nóng
  for (let i = 0; i < n; i++) {
    const o = await once(v.f);
    v.ms.push(o.ms);
    v.key = o.key;
  }
}

async function benchTenant(t: { id: string; n: number; roles: string[] }): Promise<boolean> {
  const A: V = {
    label: "A set-based (hiện tại)",
    f: (tx) => compileRoles(tx, { tenantId: t.id, roleIds: null, actorId: null }).then((r) => [r]),
    ms: [],
    key: "",
  };
  const B: V = {
    label: "B từng vai",
    f: async (tx) => {
      const out: CompileResult[] = [];
      for (const id of t.roles)
        out.push(await compileRoles(tx, { tenantId: t.id, roleIds: [id], actorId: null }));
      return out;
    },
    ms: [],
    key: "",
  };
  const client = (db.db as unknown as { $client: Sql }).$client;
  const counts = [
    (await captureSql(client, () => once(A.f))).queries.length,
    (await captureSql(client, () => once(B.f))).queries.length,
  ];
  const n = t.n > 100 ? Math.max(5, Math.floor(N / 3)) : N;
  for (let r = 0; r < ROUNDS; r++) for (const v of [A, B]) await measureV(v, n);
  const eq = A.key === B.key && A.key.length > 0;
  for (const [i, v] of [A, B].entries()) {
    const st = latencyStats(v.ms);
    console.log(
      `CR116|C4 compileRoles|${v.label}|${t.n} vai|${st.p50.toFixed(2)}|${st.p95.toFixed(2)}|${counts[i]}|${eq ? "✓" : "✗"}`,
    );
  }
  return eq;
}

describe("CR-116 · A/B compileRoles", () => {
  it("set-based (3 câu) vs từng vai (3×N câu)", async () => {
    let ok = true;
    for (const t of T) ok = (await benchTenant(t)) && ok;
    expect(ok).toBe(true);
  }, 900_000);
});
