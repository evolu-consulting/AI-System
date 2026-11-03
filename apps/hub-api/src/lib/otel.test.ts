// CR-114 hub-otel · tracing tắt mặc định (no-op, không SDK) và khi bật: traceparent đi/về, cha-con, xuất OTLP thật tới
// một collector giả; không có nội dung (prompt/trả lời) trong span.
import { afterEach, describe, expect, test } from "bun:test";
import {
  beginRun,
  endRun,
  flushOtel,
  initOtel,
  NOOP_SPAN,
  otelEnabled,
  resetOtel,
  runSpanOf,
  setTokens,
  shortTraceId,
  startSpan,
  traced,
  traceparentOf,
} from "./otel";

afterEach(() => resetOtel());

describe("OTel tắt (mặc định)", () => {
  test("vắng endpoint ⇒ initOtel không dựng SDK; mọi span là NOOP dùng chung, không traceparent", async () => {
    expect(initOtel({})).toBeNull();
    expect(otelEnabled()).toBe(false);
    const s = startSpan("x", { a: 1 });
    expect(s).toBe(NOOP_SPAN);
    expect(traceparentOf(s)).toBeUndefined();
    expect(shortTraceId(s)).toBeUndefined();
    expect(beginRun("r1", { tenant_id: "t" })).toBe(NOOP_SPAN);
    expect(runSpanOf("r1")).toBeUndefined();
    expect(await traced("y", {}, async (sp) => (sp === NOOP_SPAN ? "ok" : "bad"))).toBe("ok");
    setTokens(s, { input_tokens: 1, output_tokens: 2 }); // không ném
  });
});

type Got = { path: string; bytes: number; text: string };

function collector(): { url: string; got: Got[]; stop: () => void } {
  const got: Got[] = [];
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      const buf = await req.arrayBuffer();
      got.push({
        path: new URL(req.url).pathname,
        bytes: buf.byteLength,
        text: new TextDecoder().decode(buf),
      });
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  return { url: `http://127.0.0.1:${srv.port}`, got, stop: () => void srv.stop(true) };
}

describe("OTel bật", () => {
  test("trace một run: run → agent.step → job.enqueue cùng trace; traceparent hợp lệ và nối được từ phía kia", async () => {
    const c = collector();
    try {
      expect(initOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: `${c.url}/` })).not.toBeNull();
      expect(otelEnabled()).toBe(true);
      const run = beginRun("run-1", { tenant_id: "t-1", agent: "contract-reviewer" });
      const step = startSpan("agent.step", { run_id: "run-1" }, runSpanOf("run-1"));
      const enq = startSpan("job.enqueue", {}, step);
      const tp = traceparentOf(enq);
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
      expect(shortTraceId(run)).toBe(tp?.slice(3, 11));
      expect(shortTraceId(step)).toBe(shortTraceId(run));
      // phía nhận (Runtime/`/mcp`): span con của traceparent
      const remote = startSpan("job.run", {}, tp);
      expect(shortTraceId(remote)).toBe(shortTraceId(run));
      setTokens(step, { input_tokens: 10, output_tokens: 5 });
      remote.end();
      enq.end();
      step.end();
      endRun("run-1", { status: "finished", deltas: 3 });
      expect(runSpanOf("run-1")).toBeUndefined();
      await flushOtel();
      expect(c.got.length).toBeGreaterThan(0);
      expect(c.got[0]?.path).toBe("/v1/traces");
      const body = c.got.map((g) => g.text).join("\n");
      for (const name of ["run", "agent.step", "job.enqueue", "job.run", "tokens.in", "tenant_id"])
        expect(body).toContain(name);
    } finally {
      c.stop();
    }
  });

  test("traceparent sai định dạng ⇒ span gốc mới; lỗi ghi tên lỗi, không message", async () => {
    const c = collector();
    try {
      initOtel({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${c.url}/v1/traces` });
      const s = startSpan("x", {}, "not-a-traceparent");
      expect(traceparentOf(s)).toMatch(/^00-/);
      s.end();
      await expect(
        traced("boom", {}, async () => {
          throw new Error("secret prompt text");
        }),
      ).rejects.toThrow();
      await flushOtel();
      const body = c.got.map((g) => g.text).join("\n");
      expect(body).toContain("boom");
      expect(body).not.toContain("secret prompt text");
    } finally {
      c.stop();
    }
  });
});
