// CR-105 · L1 · Luật 4c · design §3: `resolveSlot` (đường nóng mỗi lần mở lượt duyệt HĐ) p95 ≤ 5 ms với 10.000 tenant, 50 def thư
// viện, 500 bản phát hành (10/def), 5.000 tenant có gán (nửa còn lại chạy mặc định). Đo đúng hàm chạy thật (`withHubScope` system +
// MỘT câu), 200 lượt sau 20 lượt làm nóng, tenant xen kẽ có gán / mặc định. Dữ liệu dựng theo tập (số câu cố định), rồi KHÔNG
// `analyze` (kế hoạch không phụ thuộc thống kê). In số đo thật. Chạy: `bun run test:perf` / `PERF=1 bun test …`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, uuidOf } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { resolveSlot } from "./slot-resolve.repo";

const SLOT = "contracts.approval";
const NS = 0xb5;
const N_TENANT = 10_000;
const N_DEF = 50;
const N_REL = 10;
const tenant = (i: number) => uuidOf(NS, i);
const defId = (i: number) => uuidOf(NS + 1, i);

let o: Sql;
let db: Db;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 2);
  const def = (e: string) =>
    `('7e5d${(NS + 1).toString(16).padStart(4, "0")}-0000-4000-8000-' || lpad(to_hex(${e}), 12, '0'))::uuid`;
  const ten = (e: string) =>
    `('7e5d${NS.toString(16).padStart(4, "0")}-0000-4000-8000-' || lpad(to_hex(${e}), 12, '0'))::uuid`;
  await o.unsafe(
    `insert into hub.process_defs (id, tenant_id, key, name, stages, slot, slot_body, published_version)
    select ${def("i")}, null, 'pl-perf-' || i, 'Quy trình ' || i, '[{"key":"s0"}]'::jsonb, $1,
      '{"steps":[]}'::jsonb, ${N_REL} from generate_series(1, ${N_DEF}) i`,
    [SLOT],
  );
  await o.unsafe(`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    select ${def("d")}, v, 'Quy trình ' || d, '[{"key":"s0"}]'::jsonb, jsonb_build_object('steps', '[]'::jsonb, 'v', v)
    from generate_series(1, ${N_DEF}) d, generate_series(1, ${N_REL}) v`);
  await o.unsafe(`insert into hub.process_slots (slot, default_def_id) values ($1, ${def("1")})`, [
    SLOT,
  ]);
  await o.unsafe(`insert into admin.tenants (id, key, name)
    select ${ten("i")}, 'plp' || i, 'T' || i from generate_series(1, ${N_TENANT}) i`);
  // Tenant chẵn có gán (def 1..50 vòng), lẻ chạy mặc định.
  await o.unsafe(
    `insert into hub.process_slot_assignments (tenant_id, slot, def_id)
    select ${ten("i")}, $1, ${def("(i % 50) + 1")} from generate_series(2, ${N_TENANT}, 2) i`,
    [SLOT],
  );
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(s.length * 0.95) - 1] as number;
};

describe("CR-105 · resolveSlot perf", () => {
  it("resolveSlot p95 ≤ 5 ms", async () => {
    const pick = (k: number) => 1 + ((k * 7919) % N_TENANT);
    for (let k = 0; k < 20; k++) await resolveSlot(db, tenant(pick(k)), SLOT);
    const ms: number[] = [];
    let hits = 0;
    for (let k = 20; k < 220; k++) {
      const i = pick(k);
      const t0 = performance.now();
      const r = await resolveSlot(db, tenant(i), SLOT);
      ms.push(performance.now() - t0);
      const want = i % 2 === 0 ? defId((i % 50) + 1) : defId(1);
      if (r?.defId === want && r.relVersion === N_REL) hits++;
    }
    const v = p95(ms);
    console.log(
      `resolveSlot p95 = ${v.toFixed(2)} ms (200 lượt, ${N_TENANT} tenant, ${N_DEF * N_REL} release)`,
    );
    expect(hits).toBe(200);
    expect(v).toBeLessThanOrEqual(5);
  }, 60_000);
});
