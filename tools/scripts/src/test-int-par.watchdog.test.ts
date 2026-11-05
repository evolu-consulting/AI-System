// tool-evotest-hang · logic watchdog của test:int:par — đồng hồ giả (số ms truyền vào), không sleep thật.
import { describe, expect, it } from "bun:test";
import { DEFAULT_HANG, HangWatch, hangLine, parseHangCfg } from "./test-int-par.watchdog";

const FILES = ["tests/a.int.test.ts", "tests/b.int.test.ts", "tests/c.int.test.ts"];
const S = 1000;

describe("tool-evotest-hang · parseHangCfg", () => {
  it("mặc định 120/300; env và cờ ghi đè (cờ thắng); 0 = tắt; giá trị sai ném lỗi", () => {
    expect(parseHangCfg([], {})).toEqual({ idleS: 120, fileS: 300 });
    expect(DEFAULT_HANG).toEqual({ idleS: 120, fileS: 300 });
    expect(parseHangCfg([], { INT_HANG_IDLE_S: "60", INT_HANG_FILE_S: "0" })).toEqual({
      idleS: 60,
      fileS: 0,
    });
    expect(parseHangCfg(["--hang-idle=5", "x"], { INT_HANG_IDLE_S: "60" }).idleS).toBe(5);
    expect(() => parseHangCfg(["--hang-file=abc"], {})).toThrow();
  });
});

describe("tool-evotest-hang · HangWatch", () => {
  const cfg = { idleS: 120, fileS: 300 };

  it("còn output đều ⇒ không treo; im quá idleS ⇒ idle, nêu file + test cuối + file chưa chạy", () => {
    const w = new HangWatch(FILES, cfg, 0);
    w.feed("tests/a.int.test.ts:\n(pass) mot > ca 1 [5.00ms]\n", 10 * S);
    w.feed(
      "tests/b.int.test.ts:\n(pass) hai > ca 2 [1.2s]\n(fail) hai > ca 3 [30000.00ms]\n",
      50 * S,
    );
    expect(w.check(170 * S)).toBeNull(); // im đúng 120 s: chưa quá
    const v = w.check(171 * S);
    expect(v?.reason).toBe("idle");
    expect(v?.file).toBe("tests/b.int.test.ts");
    expect(v?.lastTest).toBe("hai > ca 3");
    expect(v?.rest).toEqual(["tests/c.int.test.ts"]);
    expect(hangLine(v as NonNullable<typeof v>)).toBe(
      "TREO: tests/b.int.test.ts · test cuối: hai > ca 3 · im 121 s",
    );
  });

  it("output đều nhưng một file chạy quá fileS ⇒ file; header file mới đặt lại đồng hồ file", () => {
    const w = new HangWatch(FILES, cfg, 0);
    w.feed("tests/a.int.test.ts:\n", 0);
    for (let t = 30; t <= 300; t += 30) w.feed(`(pass) ca ${t} [1ms]\n`, t * S);
    expect(w.check(300 * S)).toBeNull();
    const v = w.check(301 * S);
    expect(v?.reason).toBe("file");
    expect(v?.file).toBe("tests/a.int.test.ts");
    expect(v?.rest).toEqual(["tests/b.int.test.ts", "tests/c.int.test.ts"]);
    w.feed("tests/b.int.test.ts:\n", 302 * S);
    expect(w.check(303 * S)).toBeNull();
  });

  it("chưa thấy header ⇒ coi file đầu của lô là file treo; dòng đứt giữa hai mảnh vẫn ghép đúng; ANSI/CRLF bỏ", () => {
    const w = new HangWatch(FILES, cfg, 0);
    expect(w.check(121 * S)?.file).toBe("tests/a.int.test.ts");
    expect(w.check(121 * S)?.rest).toEqual(["tests/b.int.test.ts", "tests/c.int.test.ts"]);
    const w2 = new HangWatch(FILES, cfg, 0);
    w2.feed("\u001b[0mtests/c.int", 1 * S);
    w2.feed(".test.ts:\r\n(pass) ca > x [1ms]\r", 2 * S);
    w2.feed("\n", 3 * S);
    const v = w2.check(500 * S);
    expect(v?.file).toBe("tests/c.int.test.ts");
    expect(v?.lastTest).toBe("ca > x");
    expect(v?.rest).toEqual([]);
  });

  it("hai luồng stdout/stderr có bộ đệm dòng riêng; cfg 0 = tắt điều kiện", () => {
    const w = new HangWatch(FILES, { idleS: 0, fileS: 0 }, 0);
    w.feed("tests/a.int.test.ts:\n", 1, 1);
    expect(w.check(10_000 * S)).toBeNull();
    const w2 = new HangWatch(FILES, { idleS: 10, fileS: 0 }, 0);
    w2.feed("tests/a.int", 1, 0);
    w2.feed(".test.ts:\n", 1, 1); // luồng khác ⇒ không ghép với mảnh trên
    expect(w2.check(100 * S)?.file).toBe("tests/a.int.test.ts"); // do mặc định file đầu, không phải do ghép
    expect(w2.check(100 * S)?.lastTest).toBe("");
  });
});
