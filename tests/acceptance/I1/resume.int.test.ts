// I1 · review B#20: chạy tiếp sau khi đứt giữa chừng với `--state`. Lượt 1 (lô 3) chết ở lần ghi thứ 9; lượt 2 dùng CÙNG file
// điểm dừng nhưng lô 2 (xếp lô khác) ⇒ phải ghi đủ mọi hàng (khoá theo nội dung lô, không theo vị trí), không lỗi FK, tiền khớp,
// file không bị đưa lên lại. Nguồn GIẢ (fixture.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImport } from "../../../apps/admin-api/src/modules/mgmt-import/application/import.usecase";
import type { TargetStore } from "../../../apps/admin-api/src/modules/mgmt-import/application/ports";
import {
  buildDeps,
  type RunConfig,
} from "../../../apps/admin-api/src/modules/mgmt-import/mgmt-import.run";
import { fakeReader, fixtureSnapshot, ORG_A, SOURCE } from "./_support/fixture";
import { type CtxI1, counts, startI1 } from "./_support/i1";

let ctx: CtxI1;
let state: string;

const cfg = (batch: number): RunConfig => ({
  source: SOURCE,
  actorId: ctx.padmin,
  apply: true,
  batch,
  knowledgeOrg: ORG_A,
  withGraph: true,
  diffSample: 5,
  opensearch: { url: "http://unused" },
  neo4j: null,
  filesDir: ctx.filesDir,
  sinkDir: ctx.sinkDir,
  statePath: state,
});

/** Đích ghi được `n` lô rồi "chết" (ném) — như tiến trình bị giết giữa chừng. */
const dying = (t: TargetStore, n: number): TargetStore => {
  let left = n;
  return {
    ...t,
    write: async (tid, table, rows) => {
      if (left-- <= 0) throw new Error("KILLED");
      return t.write(tid, table, rows);
    },
  };
};

beforeAll(async () => {
  ctx = await startI1();
  state = join(await mkdtemp(join(tmpdir(), "i1-state-")), "state.json");
});
afterAll(async () => {
  await ctx?.stop();
});

describe("I1 review B#20 · chạy tiếp theo điểm dừng", () => {
  test("đứt ở lô 9 (cỡ 3) rồi chạy tiếp cỡ 2 cùng --state ⇒ đủ hàng, tiền khớp, file không lên lại", async () => {
    const snap = fixtureSnapshot();
    const d1 = buildDeps(ctx.db, ctx.hub, cfg(3), fakeReader(snap));
    await expect(runImport(cfg(3), { ...d1, target: dying(d1.target, 8) })).rejects.toThrow(
      "KILLED",
    );
    const partial = await counts(ctx);
    expect(partial["contracts.contracts"]).toBeGreaterThan(0);
    const r = await runImport(cfg(2), buildDeps(ctx.db, ctx.hub, cfg(2), fakeReader(snap)));
    const c = await counts(ctx);
    expect(c).toMatchObject({
      "contracts.contracts": 6,
      "contracts.approvals": 6,
      "contracts.contract_items": 4,
      "contracts.files": 1,
      "contracts.cks_certificates": 3,
      "contracts.obligations": 2,
      "contracts.partner_events": 4,
      "knowledge.chunks": 3,
      "knowledge.entity_rels": 1,
    });
    expect(r.reconcile?.money_ok).toBe(true);
    expect(r.reconcile?.files).toEqual({ jobs: 1, found: 1, stored: 1, checksum_ok: 1 });
    // file đã lên ở lượt 1 không được đưa lên lần nữa (một file trong kho thư mục)
    const sink = await Array.fromAsync(new Bun.Glob("*").scan(ctx.sinkDir));
    expect(sink.length).toBe(1);
  });
});
