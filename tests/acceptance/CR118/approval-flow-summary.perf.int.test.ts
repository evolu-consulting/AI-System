// CR-118 · UW-FR-14 · Luật 4c · số đo huy hiệu flow: `POST /pack/contracts/flow/contracts.approval/summary` lô 100 HĐ (có lượt
// duyệt) qua HTTP thật ⇒ p95 ≤ 50 ms. In số thật (p50/p95/max). Số câu SQL cố định mỗi lô khoá ở unit
// (approval-flow-slot.usecase.test.ts » repo summary). Không ngủ chờ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxCf, startCf } from "../CF/_cf";
import { cid } from "../HD1/_support/hd1";
import { C1_TEXT } from "../HD2/_support/hd2";
import { PA, T } from "../P-d/_support/pd";

let c: CtxCf;
let prevFlag: string | undefined;
beforeAll(async () => {
  prevFlag = process.env.HUB_FLOW_RUNTIME;
  process.env.HUB_FLOW_RUNTIME = "on";
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
  if (prevFlag === undefined) delete process.env.HUB_FLOW_RUNTIME;
  else process.env.HUB_FLOW_RUNTIME = prevFlag;
});

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

describe("CR-118 perf [UW-FR-14]", () => {
  it("summary lô 100 HĐ có lượt duyệt ⇒ p95 ≤ 50 ms", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => cid(11800 + i));
    const runs = ids.map(() => crypto.randomUUID());
    await c.sql`insert into contracts.contracts ${c.sql(
      ids.map((id, i) => ({
        id,
        tenant_id: T.acme,
        title: `HĐ ${i}`,
        status: "needs_review",
        created_by: PA.A.id,
        source_text: C1_TEXT,
      })),
    )}`;
    await c.sql`insert into contracts.approvals ${c.sql(
      ids.map((id, i) => ({
        id: runs[i] as string,
        tenant_id: T.acme,
        contract_id: id,
        status: "level1",
        started_by: PA.A.id,
      })),
    )}`;
    await c.sql`update contracts.contracts k set run_id = a.id from contracts.approvals a
      where a.contract_id = k.id and a.tenant_id = k.tenant_id and k.id = any(${ids}::uuid[])`;
    const call = () =>
      c.call("A", "POST", "/pack/contracts/flow/contracts.approval/summary", { refs: ids });
    const warm = await call();
    expect(warm.status).toBe(200);
    expect(warm.json?.items).toHaveLength(100);
    const ms: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const r = await call();
      ms.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    const out = {
      p50: +pct(ms, 0.5).toFixed(1),
      p95: +pct(ms, 0.95).toFixed(1),
      max: +Math.max(...ms).toFixed(1),
    };
    console.log(`CR118-P01 summary lô 100: ${JSON.stringify(out)} ms`);
    expect(out.p95).toBeLessThanOrEqual(50);
  }, 120_000);
});
