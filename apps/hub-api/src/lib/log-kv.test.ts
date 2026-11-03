// CR-114 hub-otel · định dạng log kv: khuôn dòng, escape, trần 400, che bí mật, id 6 ký tự, token gộp `tk=in/out`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eventName, formatKv, KV_MAX_LINE, kvValue } from "./log-kv";
import { logger, redact, setLogFormat, setMinLevel, setSink } from "./logger";

const NOW = 1_700_000_000_500;
const fmt = (msg: string, fields = {}, trace?: string) =>
  formatKv({ level: "info", msg, fields, now: NOW, trace }, redact);
const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl";

describe("formatKv", () => {
  test("khuôn: t lvl e run ag ms tk trace; id 6 ký tự, tên agent đầy đủ", () => {
    const line = fmt(
      "run-finished",
      {
        run_id: "0a1b2c3d-1111-2222-3333-444455556666",
        tenant_id: "ffeedd00-0000-0000-0000-000000000000",
        agent: "contract-reviewer",
        duration_ms: 1234.6,
        input_tokens: 120,
        output_tokens: 45,
      },
      "abcdef0123456789",
    );
    expect(line).toBe(
      "t=1700000000 lvl=info e=run.finished run=0a1b2c tn=ffeedd ag=contract-reviewer ms=1235 tk=120/45 trace=abcdef01",
    );
  });

  test("tên sự kiện: chữ, dấu chấm; không mã số/ký tự lạ", () => {
    expect(eventName("job-enqueue-skipped")).toBe("job.enqueue.skipped");
    expect(eventName("orchestrator_tenant_invalid")).toBe("orchestrator.tenant.invalid");
    expect(eventName("Run  Started!")).toBe("run.started");
    expect(eventName("  ")).toBe("log");
  });

  test('giá trị: từ trần, chuỗi có khoảng trắng/=/" thì đặt ngoặc kép + escape, undefined bỏ', () => {
    expect(kvValue("ok")).toBe("ok");
    expect(kvValue(12)).toBe("12");
    expect(kvValue(true)).toBe("true");
    expect(kvValue(undefined)).toBeNull();
    expect(kvValue(null)).toBeNull();
    expect(kvValue("two words")).toBe('"two words"');
    expect(kvValue("a=b")).toBe('"a=b"');
    expect(kvValue('say "hi"\nnow')).toBe('"say \\"hi\\"\\nnow"');
    expect(kvValue("")).toBe('""');
    expect(kvValue(["a", "b"])).toBe("a,b");
    expect(kvValue({ a: 1 })).toBe('"{\\"a\\":1}"');
    // không có xuống dòng thật trong một dòng log
    expect(fmt("x", { error: "l1\nl2\r\nl3" })).not.toMatch(/[\r\n]/);
  });

  test("che bí mật: khoá nhạy cảm, JWT/Bearer trong giá trị và trong tên sự kiện; tk không bị che", () => {
    const line = fmt("auth-failed", {
      authorization: "Bearer abc.def",
      password: "hunter2",
      note: `got ${JWT} here`,
      input_tokens: 7,
      output_tokens: 3,
    });
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("abc.def");
    expect(line).not.toContain("eyJ");
    expect(line).toContain("authorization=[redacted]");
    expect(line).toContain("tk=7/3");
  });

  test("trần dòng: cắt ở KV_MAX_LINE ký tự, kết bằng ~", () => {
    const line = fmt("big", { error: "x y ".repeat(500) });
    expect(line.length).toBe(KV_MAX_LINE);
    expect(line.endsWith("~")).toBe(true);
    expect(fmt("small", { a: 1 }).length).toBeLessThan(KV_MAX_LINE);
  });

  test("id khác (`*_id`) cũng rút 6 ký tự; khoá lạ được chuẩn hoá", () => {
    const line = fmt("x", { agent_id: "1234567890abcdef", "Odd Name!": 1 });
    expect(line).toContain("agent_id=123456");
    expect(line).toContain("odd_name_=1");
  });
});

describe("logger LOG_FORMAT=kv", () => {
  let lines: string[] = [];
  let restore: () => void = () => {};
  beforeEach(() => {
    lines = [];
    restore = setSink((_l, line) => lines.push(line));
    setMinLevel("debug");
    setLogFormat("kv");
  });
  afterEach(() => {
    restore();
    setLogFormat("json");
    setMinLevel("warn");
  });

  test("child ctx + fields ra một dòng kv; không phải JSON", () => {
    logger.child({ run_id: "abcdef-1234", request_id: "req-1" }).info("run.started", { seq: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^t=\d+ lvl=info e=run\.started run=abcdef req=req-1 seq=1$/);
  });
});
