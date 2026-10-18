// CR-093 Luật 4c · T19-perf vòng 3 · `createSpread`: chữ ký mới ⇒ describe trên `n` kết nối mượn lần lượt (mỗi lúc một),
// chữ ký đã thấy / câu không tham số ⇒ không phát; kiểu tham số khác ⇒ chữ ký khác; lỗi describe chỉ báo, vẫn trả kết nối.
import { describe, expect, test } from "bun:test";
import { createSpread, inferredType, type SpreadConn, signatureOf } from "./prepare-spread";

function fakePool(fail?: string) {
  const log: string[] = [];
  let held = 0;
  let maxHeld = 0;
  let id = 0;
  const pool = {
    reserve: async (): Promise<SpreadConn> => {
      const me = ++id;
      maxHeld = Math.max(maxHeld, ++held);
      return {
        unsafe: (q, args, o) => ({
          describe: async () => {
            log.push(`${me}:${q}:${args.length}:${o.prepare}`);
            if (q === fail) throw new Error("parse");
          },
        }),
        release: () => {
          held--;
        },
      };
    },
  };
  return { pool, log, stats: () => ({ held, maxHeld, reserved: id }) };
}

describe("CR-093 · T19-perf vòng 3 · prepare-spread", () => {
  test("chữ ký mới ⇒ describe trên n kết nối, một kết nối mỗi lúc; trùng / không tham số ⇒ bỏ qua", async () => {
    const f = fakePool();
    const s = createSpread(f.pool, 3, () => {});
    s.see("select $1", [1]);
    s.see("select $1", [2]);
    s.see("select 1", []);
    s.see("insert into t values ($1)", ["a"]);
    await s.idle();
    expect(f.log).toEqual([
      "1:select $1:1:true",
      "1:insert into t values ($1):1:true",
      "2:select $1:1:true",
      "2:insert into t values ($1):1:true",
      "3:select $1:1:true",
      "3:insert into t values ($1):1:true",
    ]);
    expect(f.stats()).toEqual({ held: 0, maxHeld: 1, reserved: 3 });
    expect(s.size()).toBe(2);
    s.see("select $1", [3]);
    await s.idle();
    expect(f.stats().reserved).toBe(3);
  });

  test("kiểu tham số khác (bool vs chuỗi) ⇒ chữ ký khác, như bộ đệm postgres.js", () => {
    expect(inferredType(true)).toBe(16);
    expect(inferredType(new Date(0))).toBe(1184);
    expect(inferredType(["x"])).toBe(0);
    expect(inferredType(1n)).toBe(20);
    expect(signatureOf("q", [true])).not.toBe(signatureOf("q", ["t"]));
    expect(signatureOf("q", [1])).toBe(signatureOf("q", ["1"]));
  });

  test("describe lỗi ⇒ onError, câu khác vẫn phát, kết nối vẫn trả", async () => {
    const f = fakePool("bad $1");
    const errs: unknown[] = [];
    const s = createSpread(f.pool, 2, (e) => errs.push(e));
    s.see("bad $1", [1]);
    s.see("good $1", [1]);
    await s.idle();
    expect(errs).toHaveLength(2);
    expect(f.log.filter((l) => l.includes("good"))).toHaveLength(2);
    expect(f.stats().held).toBe(0);
  });

  test("reserve lỗi (pool đã đóng) ⇒ onError, idle() vẫn xong", async () => {
    const errs: unknown[] = [];
    const s = createSpread({ reserve: () => Promise.reject(new Error("ended")) }, 2, (e) =>
      errs.push(e),
    );
    s.see("select $1", [1]);
    await s.idle();
    expect(errs).toHaveLength(1);
  });
});
