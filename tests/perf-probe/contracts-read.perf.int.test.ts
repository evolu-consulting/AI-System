// CR-116 · kịch bản `contracts.read`: danh sách (4 tổ hợp lọc) + chi tiết hợp đồng qua HTTP thật của Hub (probe mã thật:
// `contracts.list`, `contracts.detail` — SQL/round trip; cộng `http.*` ở đây). Dữ liệu = `seedPerf` của HD-NFR-01 (3 tenant × 10.000
// HĐ + nền 70.000, set-based, ANALYZE sau seed). small = 30 lần/tổ hợp; large = 200 (HD1_PERF_N mặc định).
// Fixture dùng lại của `tests/acceptance/HD1/perf/list.perf.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { probe } from "@ai/db/probe";
import {
  CBASE,
  type CtxN1,
  ensureRoles,
  getWith,
  needContracts,
  P,
  startHd1,
} from "../acceptance/HD1/_support/hd1";
import { analyzeAll, restoreAutovacuum, seedPerf } from "../acceptance/HD1/_support/seed";
import { probing, runScenario } from "./_scn";

let c: CtxN1;
let token = "";
let seeded = false;
beforeAll(async () => {
  if (probing) c = await startHd1();
}, 60_000);
afterAll(async () => {
  if (seeded) await restoreAutovacuum(c.sql).catch(() => {});
  await c?.stop();
});

const COMBOS: Record<string, string> = {
  nofilter: "",
  status: "?status=active",
  q3: "?q=ben",
  lastpage: "?page=500&page_size=20",
};

describe.skipIf(!probing)("probe · contracts.read (HD-NFR-01)", () => {
  it("contracts.read · danh sách + chi tiết", async () => {
    await needContracts(c.sql);
    await ensureRoles(c);
    await seedPerf(c.sql);
    seeded = true;
    await analyzeAll(c.sql);
    token = await c.tok(P.tam);
    const first = await getWith(c, token, `${CBASE}?page_size=20`);
    const id = (first.json?.items as { id: string }[] | undefined)?.[0]?.id;
    expect(id).toBeTruthy();
    for (const q of Object.values(COMBOS)) await getWith(c, token, `${CBASE}${q}`); // làm nóng pool
    await runScenario("contracts.read", c.sql, async (_r, size) => {
      const n = size === "large" ? 200 : 30;
      for (const [name, q] of Object.entries(COMBOS))
        for (let i = 0; i < n; i++) {
          const res = await probe(`http.list.${name}`, () => getWith(c, token, `${CBASE}${q}`));
          expect(res.status).toBe(200);
        }
      for (let i = 0; i < n; i++) {
        const res = await probe("http.detail", () => getWith(c, token, `${CBASE}/${id}`));
        expect(res.status).toBe(200);
      }
    });
  }, 900_000);
});
