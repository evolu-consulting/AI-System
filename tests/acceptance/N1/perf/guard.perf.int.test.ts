// PK-NFR-01 · PK-NFR-05 (không thuộc Lệnh xong, `bun run test:perf`) · plan §10: kiểm quyền gói mỗi request — thêm p95 ≤ 2 ms khi
// cache nóng. Đo HIỆU p95(GET /pack/pkdemo/me) − p95(GET /health, cùng hub, không guard) trên 10.000 lượt mỗi bên (tuần tự);
// báo số thật. 0 câu SQL khi nóng đã khoá ở hops.int.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxN1,
  needPackKit,
  P,
  PK,
  percentile,
  startN1,
  T,
  untilHubSettles,
} from "../_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const N = 10_000;

describe("PK-NFR-01 · guard quyền gói p95 ≤ 2 ms (cache nóng)", () => {
  it("PK-NFR-01 · 10.000 lượt /me nóng: p95 guard (trừ nền /health) ≤ 2 ms", async () => {
    await needPackKit(c.sql);
    await c.enable(T.acme);
    await c.addToRole(T.acme, "editor", [P.hoa]);
    const token = await c.tok(P.hoa);
    const h = { authorization: `Bearer ${token}` };
    const me = `${c.hub.base}/pack/${PK}/me`;
    const base = `${c.hub.base}/health`;
    const ready = await untilHubSettles(
      c.hub,
      async () => (await fetch(me, { headers: h })).json() as Promise<{ actions: string[] }>,
      (j) => j.actions.includes("write"),
    );
    expect(ready.actions).toEqual(["read", "write"]);
    const run = async (url: string, headers?: Record<string, string>): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < 200; i++) await (await fetch(url, { headers })).arrayBuffer(); // làm nóng JIT/kết nối
      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        const r = await fetch(url, { headers });
        await r.arrayBuffer();
        out.push(performance.now() - t0);
      }
      return out;
    };
    const a = await run(base);
    const b = await run(me, h);
    const p95Base = percentile(a, 95);
    const p95Me = percentile(b, 95);
    const extra = p95Me - p95Base;
    console.log(
      `PK-NFR-01 · p95 /health=${p95Base.toFixed(3)} ms · p95 /me=${p95Me.toFixed(3)} ms · thêm=${extra.toFixed(3)} ms (n=${N})`,
    );
    expect(extra).toBeLessThanOrEqual(2);
  }, 120_000);
});
