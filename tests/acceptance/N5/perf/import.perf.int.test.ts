// N5-NFR-01 · Luật 4c · chuyển 10.000 user (1 org, lô 500 ⇒ 20 lô): tổng ≤ 30 s, số câu SQL mỗi lô CỐ ĐỊNH (apply ≤ 6 gồm
// set_config, dry-run ≤ 2, lô org ≤ 10) — đếm bằng hook `options.debug` của pool postgres.js (bỏ begin/commit/notify).
// In số thật (console) để ghi vào báo cáo. Dữ liệu GIẢ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runIdentityImport } from "../../../../apps/admin-api/src/modules/identity-import/identity-import.run";
import { type CtxN5, mkExport, SCRYPT_HASH, startN5, userX } from "../_support/n5";

const N = 10_000;
const BATCH = 500;
const BUDGET_MS = 30_000;
const CTL = /^\s*(begin|commit|rollback|savepoint|release)\b|pg_notify|select b\.oid, b\.typarray/i;
type PoolOpts = { debug?: (conn: number, q: string, ...rest: unknown[]) => void };

let c: CtxN5;
beforeAll(async () => {
  c = await startN5({ max: 1 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const raw = mkExport(
  [{ id: "perf-org", name: "Perf Org", tenant_key: "perf-n5" }],
  Array.from({ length: N }, (_, i) =>
    userX(`user${i}@perf.test`, "perf-org", i % 3 === 0 ? "viewer" : "editor", SCRYPT_HASH),
  ),
);

/** Chạy và đếm câu theo từng lô (ranh giới lô = callback `onBatch` của công cụ). */
async function measured(apply: boolean) {
  const opts = ((c.db.db as unknown as { $client: { options: PoolOpts } }).$client.options ??
    null) as PoolOpts | null;
  if (!opts) throw new Error("không thấy pool postgres.js (db.db.$client.options)");
  const counts: { kind: string; n: number }[] = [];
  let n = 0;
  const prev = opts.debug;
  opts.debug = (_conn, q) => {
    if (!CTL.test(q)) n++;
  };
  const t0 = performance.now();
  try {
    const r = await runIdentityImport(c.db, raw, {
      actorId: c.padmin,
      apply,
      batch: BATCH,
      onBatch: (kind) => {
        counts.push({ kind, n });
        n = 0;
      },
    });
    return { r, ms: performance.now() - t0, counts };
  } finally {
    opts.debug = prev;
  }
}

describe("N5-NFR-01 · 10.000 user theo lô", () => {
  it("N5-NFR-01 · dry-run: mỗi lô user ≤ 2 câu, không ghi", async () => {
    const m = await measured(false);
    const users = m.counts.filter((x) => x.kind === "user");
    console.log(
      `[N5 perf] dry-run ${N} user: ${m.ms.toFixed(0)} ms, ${users.length} lô, câu/lô max ${Math.max(...users.map((x) => x.n))}`,
    );
    expect(users).toHaveLength(N / BATCH);
    expect(Math.max(...users.map((x) => x.n))).toBeLessThanOrEqual(2);
    expect(m.r.users.created).toBe(N);
  }, 60_000);

  it("N5-NFR-01 · apply: ≤ 30 s, mỗi lô user ≤ 6 câu (cố định), lô org ≤ 10", async () => {
    const m = await measured(true);
    const users = m.counts.filter((x) => x.kind === "user").map((x) => x.n);
    const orgs = m.counts.filter((x) => x.kind === "org").map((x) => x.n);
    console.log(
      `[N5 perf] apply ${N} user: ${m.ms.toFixed(0)} ms, ${users.length} lô user (câu/lô ${[...new Set(users)].join("/")}), lô org ${orgs.join("/")} câu`,
    );
    expect(m.r.users.created).toBe(N);
    expect(m.r.users.reset_required).toBe(N);
    expect(users).toHaveLength(N / BATCH);
    expect(new Set(users).size).toBe(1);
    expect(Math.max(...users)).toBeLessThanOrEqual(6);
    expect(Math.max(...orgs)).toBeLessThanOrEqual(10);
    expect(m.ms).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it("N5-NFR-01 · chạy lại (idempotent): 0 tạo, mỗi lô ≤ 2 câu (không có gì để ghi ⇒ không bump/audit)", async () => {
    const m = await measured(true);
    const users = m.counts.filter((x) => x.kind === "user").map((x) => x.n);
    console.log(
      `[N5 perf] chạy lại ${N} user: ${m.ms.toFixed(0)} ms, câu/lô max ${Math.max(...users)}`,
    );
    expect(m.r.users.created).toBe(0);
    expect(m.r.users.existing).toBe(N);
    expect(Math.max(...users)).toBeLessThanOrEqual(2);
  }, 120_000);
});
