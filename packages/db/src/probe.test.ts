import { afterEach, describe, expect, test } from "bun:test";
import {
  pctile,
  probe,
  probeEmit,
  probeLine,
  probeSamples,
  probeStats,
  probeSync,
  resetProbe,
  setProbe,
  sqlCounters,
  sqlTap,
} from "./probe";

const LINE = /^t=\d+ e=probe\.x ms=[\d.]+ cpu=[\d.]+ rss=-?\d+ sql=\d+ rt=\d+$/;

function capture<T>(fn: () => Promise<T>): Promise<{ r: T; out: string[] }> {
  const out: string[] = [];
  const w = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string | Uint8Array) => {
    out.push(String(s));
    return true;
  }) as typeof process.stdout.write;
  return fn()
    .then((r) => ({ r, out }))
    .finally(() => {
      process.stdout.write = w;
    });
}

afterEach(() => {
  setProbe(false);
  resetProbe();
});

describe("probe tắt (mặc định)", () => {
  test("không ghi gì, không lưu mẫu, trả kết quả/lỗi của fn nguyên vẹn", async () => {
    const { r, out } = await capture(async () => {
      probeEmit("meta", { a: 1 });
      expect(probeSync("x", () => 7)).toBe(7);
      await expect(probe("x", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
      return probe("x", async () => 42);
    });
    expect(r).toBe(42);
    expect(out).toEqual([]);
    expect(probeSamples()).toEqual([]);
  });

  test("micro-bench: overhead mỗi lời gọi rất nhỏ so với fn rỗng", () => {
    const N = 300_000;
    const f = () => 1;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) probeSync("x", f);
    const perCallUs = ((performance.now() - t0) * 1000) / N;
    expect(perCallUs).toBeLessThan(2); // một so sánh boolean + gọi hàm; ngưỡng rộng cho máy dùng chung
  });
});

describe("probe bật", () => {
  test("một dòng kv đúng ngữ pháp + mẫu trong tiến trình, kể cả khi fn ném", async () => {
    setProbe(true);
    const { out } = await capture(async () => {
      await probe("x", async () => {
        await Bun.sleep(5);
      });
      await probe("x", () => Promise.reject(new Error("e"))).catch(() => {});
    });
    expect(out.length).toBe(2);
    for (const l of out) expect(l.trim()).toMatch(LINE);
    expect(probeSamples().length).toBe(2);
    expect(probeSamples()[0]?.ms).toBeGreaterThanOrEqual(4);
  });

  test("tap SQL: đếm câu nghiệp vụ, bỏ begin/commit; round trip gộp pipeline cùng tick, tách theo tick", async () => {
    setProbe(true);
    const tap = sqlTap();
    const before = sqlCounters();
    await capture(async () => {
      await probe("x", async () => {
        tap(1, "begin", []);
        tap(1, "select 1", []);
        tap(1, "select 2", []); // cùng tick, cùng kết nối ⇒ chung round trip với 2 câu trên
        tap(2, "select 3", []); // kết nối khác ⇒ round trip riêng
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        tap(1, "commit", []); // tick mới ⇒ round trip mới
      });
    });
    const s = probeSamples()[0];
    expect(s?.sql).toBe(3);
    expect(s?.rt).toBe(3);
    expect(sqlCounters().sql - before.sql).toBe(3);
  });

  test("tap chuỗi hoá debug cũ và bỏ qua type-discovery", () => {
    const seen: string[] = [];
    const tap = sqlTap((_c, q) => seen.push(q));
    const b = sqlCounters();
    tap(9, "select b.oid, b.typarray from pg_catalog.pg_type b", []);
    expect(seen.length).toBe(1);
    expect(sqlCounters()).toEqual(b);
  });
});

describe("thống kê", () => {
  test("pctile + probeStats + probeLine", () => {
    expect(pctile([5, 1, 3], 50)).toBe(3);
    const mk = (ms: number) => ({ name: "a", ms, cpu: 0, rss: 0, sql: 0, rt: 0 });
    const { a: st } = probeStats([1, 2, 3, 4].map(mk));
    expect(st).toEqual({ n: 4, p50: 2, p95: 4, mean: 2.5 });
    expect(probeLine("m", { v: "a b", n: 1, u: undefined }, 5000)).toBe(
      't=5 e=probe.m v="a b" n=1',
    );
  });
});
