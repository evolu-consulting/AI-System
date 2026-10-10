// HUB-BR-25 · AC-H29 · C5 · ma trận cách ly — cột PF4 `usage` (test-plan-int §6; plan-contract §8). Mỗi ô một `it`
// `M-<vai>-usage`. R1 = A bắt đầu ở R (`waiting_review`; review Group Kế toán + T chuyển; ask đóng A → H) có usage fixture;
// A' (U5) = L (q05, đã rời R) trên R1a cùng dạng. full / s = `summary` / 4 = 404. D, P gọi kèm `?tenant_id=acme`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, type Json, PA, type Role, startPa, T } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { callQ06, seedUsageDef, type UsageFix, usageRun } from "./_local";

let c: CtxPa;
let r1: UsageFix;
let r1a: UsageFix;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedUsageDef(c);
  r1 = await usageRun(c, PA.A);
  r1a = await usageRun(c, PA.L);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

type Who = Role | "q06";
const ROWS: [string, Who, "full" | "summary" | 404, "r1" | "r1a"][] = [
  ["A", "A", "full", "r1"],
  ["X", "X", "full", "r1"],
  ["A'", "L", "summary", "r1a"],
  ["L", "L", 404, "r1"],
  ["B", "B", "full", "r1"],
  ["T", "T", "summary", "r1"],
  ["H", "H", "summary", "r1"],
  ["q06", "q06", 404, "r1"],
  ["D", "D", 404, "r1"],
  ["Adm", "Adm", "full", "r1"],
  ["P", "P", "full", "r1"],
];

function expectUsage(
  r: { status: number; json: Json },
  want: "full" | "summary" | 404,
  total: number,
): void {
  if (want === 404) {
    expect(r.status).toBe(404);
    return;
  }
  expect({ status: r.status, detail: r.json?.detail }).toEqual({ status: 200, detail: want });
  expect(r.json?.totals?.total).toBe(total);
  const stages: Json[] = r.json?.stages ?? [];
  if (want === "summary") for (const s of stages) expect([s.team_runs, s.calls]).toEqual([[], []]);
}

describe("M-* · cột usage [HUB-BR-25, PF4]", () => {
  for (const [name, who, want, k] of ROWS)
    it(`HUB-BR-25 · M-${name}-usage · ${name} GET usage ⇒ ${want}`, async () => {
      needSchema(c.ready);
      const f = k === "r1" ? r1 : r1a;
      const path = `/process-runs/${f.run.runId}/usage${who === "D" || who === "P" ? `?tenant_id=${T.acme}` : ""}`;
      const r = who === "q06" ? await callQ06(c, "GET", path) : await c.call(who, "GET", path);
      expectUsage(r, want, f.total);
    });
});
