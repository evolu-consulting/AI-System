// CR-118 · D4 ngưỡng (không thuộc Lệnh xong, `-Step perf`): đo p95 HTTP tuần tự trên hub-api thật, cache nóng.
// GET /pack/me nóng ≤ 5 ms · 304 ≤ 2 ms · GET capabilities nóng ≤ 20 ms. Báo kèm nền /health (cùng hub) để đọc tải máy.
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
} from "../../N1/_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const N = 3_000;

async function run(url: string, headers: Record<string, string>, expectStatus: number) {
  const out: number[] = [];
  for (let i = 0; i < 200; i++) await (await fetch(url, { headers })).arrayBuffer(); // làm nóng
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const r = await fetch(url, { headers });
    await r.arrayBuffer();
    out.push(performance.now() - t0);
    if (r.status !== expectStatus) throw new Error(`status ${r.status} ≠ ${expectStatus}`);
  }
  return percentile(out, 95);
}

describe("CR-118 · perf năng lực (cache nóng)", () => {
  it("UW-FR-04/16 · p95 /pack/me ≤ 5 ms, 304 ≤ 2 ms, capabilities ≤ 20 ms", async () => {
    await needPackKit(c.sql);
    await c.enable(T.acme);
    await c.addToRole(T.acme, "editor", [P.hoa]);
    const h = { authorization: `Bearer ${await c.tok(P.hoa)}` };
    const ha = { authorization: `Bearer ${await c.tok(P.padmin)}` };
    const me = `${c.hub.base}/pack/me`;
    const caps = `${c.hub.base}/hub-admin/tenants/${T.acme}/capabilities`;
    await untilHubSettles(
      c.hub,
      async () =>
        (await fetch(me, { headers: h })).json() as Promise<{
          packs: Record<string, { actions: string[] }>;
        }>,
      (j) => j.packs?.[PK]?.actions?.includes("write") === true,
    );
    const etag = (await fetch(me, { headers: h })).headers.get("etag") ?? "";
    const health = await run(`${c.hub.base}/health`, {}, 200);
    const pMe = await run(me, h, 200);
    const p304 = await run(me, { ...h, "if-none-match": etag }, 304);
    const pCaps = await run(caps, ha, 200);
    console.log(
      `CR-118 perf · n=${N} · p95 /health=${health.toFixed(3)} · /pack/me=${pMe.toFixed(3)} · 304=${p304.toFixed(3)} · capabilities=${pCaps.toFixed(3)} ms`,
    );
    expect({ me: pMe <= 5, nm: p304 <= 2, caps: pCaps <= 20 }).toEqual({
      me: true,
      nm: true,
      caps: true,
    });
  }, 180_000);
});
