// CR-115 · cr115-fix · HUB-FR-143/144 · `fireDueTimers` đường lô: hàng `ok:false` (savepoint ROLLBACK) ⇒ `fireOne` đúng một
// lần cho hàng đó (TB1); cả tx `systemEach` ném SAU khi đã chọn hàng (COMMIT/claim lỗi) ⇒ từng hàng đã chọn đi `fireOne`
// (lỗi nữa ⇒ lùi hạn từng hàng), không về lại đầu `order by due_at` (Thấp2).
import { describe, expect, it } from "bun:test";
import type { ProcessBgDeps } from "../../core/ports";
import { type DueTimer, fireDueTimers } from "./timer-sweep";

const TID = "a1000000-0000-4000-8000-000000000001";
const due = (n: number): DueTimer => ({
  id: `t${n}`,
  tenant_id: TID,
  process_run_id: `r${n}`,
  stage_run_id: `s${n}`,
});

type Each = (
  claim: (t: unknown) => Promise<readonly DueTimer[]>,
  tenantOf: (t: DueTimer) => string,
  fn: unknown,
) => Promise<unknown>;

function deps(o: { each: Each; systemFails?: Set<string> }) {
  const system: string[] = [];
  const postponeTx: string[] = [];
  const warns: string[] = [];
  const d = {
    now: () => new Date("2026-11-03T00:00:00Z"),
    log: { warn: (m: string) => void warns.push(m) },
    // `postponeFailed`: tx scope system — đọc hẹn (không thấy ⇒ thôi).
    db: {
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          postponeTx.push("tx");
          return cb({ execute: async () => [] });
        },
      },
    },
    sysUow: {
      systemEach: o.each,
      system: async (tid: string, _fn: unknown) => {
        system.push(tid);
        if (o.systemFails?.has(String(system.length))) throw new Error("fireOne lỗi");
        return "fired";
      },
    },
  } as unknown as ProcessBgDeps;
  return { d, system, postponeTx, warns };
}

/** `claim` nhận tx giả trả `rows` (lượt đầu), các tx song song khác không nhặt gì. */
function claimOnce(rows: DueTimer[]): (_: unknown) => { execute: () => Promise<DueTimer[]> } {
  let used = false;
  return () => {
    const r = used ? [] : rows;
    used = true;
    return { execute: async () => r };
  };
}

describe("CR-115 · fireDueTimers theo lô", () => {
  it("TB1 · hàng ok:false ⇒ fireOne đúng 1 lần cho hàng đó; hàng ok không đi fireOne", async () => {
    const tx = claimOnce([due(1), due(2)]);
    const f = deps({
      each: async (claim) => {
        const rows = await claim(tx(null));
        if (rows.length === 0) return [];
        return [
          { item: rows[0], ok: true, value: "fired" },
          { item: rows[1], ok: false, error: new Error("requeue lỗi") },
        ];
      },
    });
    const n = await fireDueTimers(f.d);
    expect({ n, system: f.system }).toEqual({ n: 2, system: [TID] });
  });

  it("Thấp2 · cả tx lô ném sau claim ⇒ mỗi hàng đã chọn đi fireOne; fireOne lỗi ⇒ lùi hạn đúng hàng đó", async () => {
    const tx = claimOnce([due(1), due(2), due(3)]);
    const f = deps({
      systemFails: new Set(["2"]),
      each: async (claim) => {
        const rows = await claim(tx(null));
        if (rows.length > 0) throw Object.assign(new Error("COMMIT lỗi"), { code: "08006" });
        return [];
      },
    });
    const n = await fireDueTimers(f.d);
    expect({ n, system: f.system.length, postpone: f.postponeTx.length }).toEqual({
      n: 2,
      system: 3,
      postpone: 1,
    });
    expect(f.warns).toContain("process-timer-batch-failed");
  });

  it("Thấp2 · claim ném (chưa chọn hàng nào) ⇒ lượt trả 0, không ném", async () => {
    const f = deps({
      each: async () => {
        throw new Error("claim lỗi");
      },
    });
    expect(await fireDueTimers(f.d)).toBe(0);
    expect(f.system).toEqual([]);
  });
});
