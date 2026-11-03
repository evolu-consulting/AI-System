// CR-114 · parse + pretty-print log kv (escape, thứ tự cột, dòng lạ giữ nguyên).
import { describe, expect, test } from "bun:test";
import { clock, isKvLine, jsonToRecord, parseKv, prettyLine, recordOf } from "./log-view.rules";

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

  test("log JSON (hub-api / Runtime) in giống bản kv của cùng sự kiện; --run lọc được cả hai", () => {
    const kv =
      "t=1700000000 lvl=info e=run.finished run=0a1b2c ag=reviewer ms=1235 tk=120/45 seq=3";
    const hub = JSON.stringify({
      level: "info",
      time: "2023-11-14T22:13:20.000Z",
      msg: "run-finished",
      run_id: "0a1b2c3d-1111",
      agent: "reviewer",
      ms: 1234.6,
      input_tokens: 120,
      output_tokens: 45,
      seq: 3,
    });
    const rt = JSON.stringify({
      level: "info",
      ts: "2023-11-14T22:13:20+00:00",
      event: "run_finished",
      run_id: "0a1b2c3d-1111",
      agent: "reviewer",
      latency_ms: 1235,
    });
    const want = prettyLine(kv, { utc: true });
    expect(prettyLine(hub, { utc: true })).toBe(want);
    expect(prettyLine(rt, { utc: true })).toBe(
      `${clock(1700000000, true)} INFO  run.finished run=0a1b2c ag=reviewer ms=1235`,
    );
    for (const l of [kv, hub, rt]) expect(recordOf(l)?.run).toBe("0a1b2c");
    expect(jsonToRecord("{not json")).toBeNull();
    expect(recordOf("plain text")).toBeNull();
  });

  test("màu chỉ khi bật", () => {
    const l = "t=1 lvl=error e=x";
    expect(prettyLine(l, { color: false })).not.toContain("\x1b[");
    expect(prettyLine(l, { color: true })).toContain("\x1b[31m");
  });
});
