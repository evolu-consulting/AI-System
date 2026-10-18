// CR-093 Luật 4c · T19-perf · `preparing`: `unsafe` của Drizzle đi câu chuẩn bị (prepare: true), kể cả trong `begin`/`savepoint`
// lồng nhau; tuỳ chọn người gọi truyền vẫn thắng; thuộc tính khác (vd `options` mà test đếm câu gắn `debug`) giữ nguyên.
import { describe, expect, test } from "bun:test";
import { preparing } from "./client";

type Call = { q: string; args: unknown[] | undefined; o: Record<string, unknown> | undefined };
function fake(calls: Call[]) {
  const s = {
    options: { max: 1 },
    unsafe: (q: string, args?: unknown[], o?: Record<string, unknown>) => {
      calls.push({ q, args, o });
      return q;
    },
    begin: (...a: unknown[]) => (a.pop() as (tx: unknown) => unknown)(fake(calls)),
    savepoint: (fn: (tx: unknown) => unknown) => fn(fake(calls)),
  };
  return s;
}

describe("ADM-NFR-06 · T19-perf · preparing", () => {
  test("unsafe ⇒ prepare: true; begin/savepoint lồng nhau cũng vậy; options giữ nguyên đối tượng", () => {
    const calls: Call[] = [];
    const raw = fake(calls);
    const p = preparing(raw);
    expect(p.options).toBe(raw.options);
    p.unsafe("select $1", [1]);
    p.begin("read write", (tx: unknown) => {
      const t = tx as ReturnType<typeof fake>;
      t.unsafe("select 2", []);
      return t.savepoint((sp: unknown) => (sp as ReturnType<typeof fake>).unsafe("select 3"));
    });
    p.unsafe("select 4", [], { prepare: false });
    expect(calls.map((c) => c.o?.prepare)).toEqual([true, true, true, false]);
    expect(calls[0]?.args).toEqual([1]);
  });
});
