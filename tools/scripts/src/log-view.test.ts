// CR-114 · parse + pretty-print log kv (escape, thứ tự cột, dòng lạ giữ nguyên).
import { describe, expect, test } from "bun:test";
import { clock, isKvLine, parseKv, prettyLine } from "./log-view.rules";

describe("log:view", () => {
  test("parseKv: từ trần, ngoặc kép có escape, tk", () => {
    expect(parseKv('t=1 lvl=warn e=a.b run=0a1b2c error="say \\"hi\\"\\nnow" tk=3/4')).toEqual({
      t: "1",
      lvl: "warn",
      e: "a.b",
      run: "0a1b2c",
      error: 'say "hi"\nnow',
      tk: "3/4",
    });
  });

  test("prettyLine: giờ + mức + sự kiện, cột run/ag/ms/tk/trace trước phần còn lại", () => {
    // thứ tự đảo để chắc `prettyLine` tự xếp cột
    const shuffled = `t=1700000000 lvl=info e=run.finished tk=120/45 ms=1235 ag=reviewer run=0a1b2c seq=3 note="a b"`;
    const out = prettyLine(shuffled, { utc: true });
    expect(out).toBe(
      `${clock(1700000000, true)} INFO  run.finished run=0a1b2c ag=reviewer ms=1235 tk=120/45  seq=3 note="a b"`,
    );
  });

  test("dòng không phải kv (JSON cũ, chữ lạ) giữ nguyên", () => {
    expect(isKvLine('{"level":"info"}')).toBe(false);
    expect(prettyLine('{"level":"info"}')).toBe('{"level":"info"}');
  });

  test("màu chỉ khi bật", () => {
    const l = "t=1 lvl=error e=x";
    expect(prettyLine(l, { color: false })).not.toContain("\x1b[");
    expect(prettyLine(l, { color: true })).toContain("\x1b[31m");
  });
});
