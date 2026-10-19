// N3-NFR-01 · Luật 4c (không thuộc Lệnh xong, `PERF=1 bun run test:perf`): lô 100, nền 10.000 thông báo. Đo từng pha DB của worker
// (chia kênh · nhận · ghi kết cục) và ghi vào cổng (`notify.enqueue` lô 100) — mỗi pha p95 ≤ 50 ms. KHÔNG `analyze` sau khi chèn
// hàng loạt (thống kê bảng cũ — kế hoạch phải không phụ thuộc). Số câu SQL mỗi lô cố định (3) bất kể 10.000 hàng. Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  drain,
  needNotify,
  notice,
  P,
  packSender,
  resetNotify,
  type Sql,
  setupX2a,
  startWorker,
  T,
  type Worker,
} from "../_support/n3";

const BATCH = 100;
const TOTAL = 10_000;
const THRESHOLD_MS = 50;

let sql: Sql;
let w: Worker;
beforeAll(async () => {
  sql = await setupX2a();
  await needNotify(sql);
  w = startWorker();
});
afterAll(async () => {
  await w?.stop();
  await sql.end();
});

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? Number.NaN;
};

async function timed<R>(out: number[], fn: () => Promise<R>): Promise<R> {
  const t0 = performance.now();
  const r = await fn();
  out.push(performance.now() - t0);
  return r;
}

describe("N3-NFR-01 · lô 100 trên nền 10.000 thông báo", () => {
  it("ghi cổng lô 100, chia kênh, nhận, ghi kết cục: mỗi pha p95 ≤ 50 ms; 3 câu SQL mỗi lô", async () => {
    await resetNotify(sql);
    const users = [P.lan.id, P.hoa.id, P.tam.id];
    // Pha ghi: 100 lô × 100 hàng = 10.000 thông báo, qua đúng cổng gói (role pkdemo_rw + hàm DEFINER).
    const enqMs: number[] = [];
    const sender = packSender("pkdemo", T.acme);
    for (let b = 0; b < TOTAL / BATCH; b++) {
      const rows = Array.from({ length: BATCH }, (_, i) =>
        notice(users[(b + i) % users.length] as string, { dedup_key: `p${b}-${i}`, body: "nền" }),
      );
      await timed(enqMs, () => sender.send(rows));
    }
    await sender.close();
    const [c] = await sql<{ n: number }[]>`select count(*)::int as n from hub.notifications`;
    expect(c?.n).toBe(TOTAL);

    // Pha worker: đúng 100 lô; đo từng lời gọi kho.
    const fanMs: number[] = [];
    const claimMs: number[] = [];
    const settleMs: number[] = [];
    const store = w.deps.store;
    w.deps.store = {
      fanout: (n, l) => timed(fanMs, () => store.fanout(n, l)),
      claim: (n, l, s) => timed(claimMs, () => store.claim(n, l, s)),
      settle: (n, r, g) => timed(settleMs, () => store.settle(n, r, g)),
    };
    const t0 = performance.now();
    const hops = await w.count(async () => {
      let sent = 0;
      for (let i = 0; i < TOTAL / BATCH; i++) sent += (await drain(w.deps, 1)).sent;
      return sent;
    });
    const wall = performance.now() - t0;
    expect(hops.r).toBe(TOTAL);
    expect(w.email.sent).toHaveLength(TOTAL);
    expect(hops.n).toBe((TOTAL / BATCH) * 3); // 3 câu mỗi lô, không đổi theo số hàng

    const row = (name: string, xs: number[]) =>
      `${name}: p50=${pct(xs, 50).toFixed(2)} p95=${pct(xs, 95).toFixed(2)} max=${Math.max(...xs).toFixed(2)} ms (n=${xs.length})`;
    console.log(
      `N3-NFR-01 · lô ${BATCH}, nền ${TOTAL}, ngưỡng ${THRESHOLD_MS} ms · ${row("ghi cổng", enqMs)} · ${row("chia kênh", fanMs)} · ${row("nhận", claimMs)} · ${row("ghi kết cục", settleMs)} · ${hops.n} câu/${TOTAL / BATCH} lô · 10.000 gửi xong ${(wall / 1000).toFixed(2)} s`,
    );
    for (const xs of [enqMs, fanMs, claimMs, settleMs]) {
      expect(pct(xs, 95)).toBeLessThanOrEqual(THRESHOLD_MS);
    }
  }, 300_000);
});
