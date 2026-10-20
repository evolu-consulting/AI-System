// ai-sub · provider gói Claude (unit, runner CLI GIẢ — không chạy CLI thật, không AI thật): cờ CLI một lượt không tool, env trắng
// (không lọt khoá API), parse JSON kết quả → usage/model, chưa đăng nhập ⇒ UNAVAILABLE, lỗi ⇒ FAILED, giới hạn chạy cùng lúc
// (chờ bằng tín hiệu, không sleep), huỷ khi đang chờ.
import { describe, expect, test } from "bun:test";
import type { ModelRequest } from "./ai-client";
import {
  type CliOutput,
  type CliRun,
  claudeCliProvider,
  cliArgs,
  replyOf,
  SYSTEM_ARG_MAX,
} from "./claude-cli.provider";

const ok = (o: Partial<Record<string, unknown>> = {}): CliOutput => ({
  exitCode: 0,
  stderr: "",
  stdout: JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "xin chào",
    usage: {
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
    },
    modelUsage: {
      "claude-haiku-5-5": { outputTokens: 1 },
      "claude-sonnet-5-5": { outputTokens: 3 },
    },
    ...o,
  }),
});
const req = (o: Partial<ModelRequest> = {}): ModelRequest => ({
  model: "claude-sonnet-5-5",
  system: "hệ thống",
  prompt: "câu hỏi",
  maxTokens: 777,
  signal: new AbortController().signal,
  ...o,
});
function recorder(out: () => Promise<CliOutput> | CliOutput) {
  const calls: Parameters<CliRun>[] = [];
  const run: CliRun = async (...a) => {
    calls.push(a);
    return out();
  };
  return { run, calls };
}

describe("claudeCliProvider (gói Claude)", () => {
  test("một lượt `-p --output-format json`, không tool/MCP/phiên; lời nhắc qua stdin; env trắng + trần output", async () => {
    const r = recorder(() => ok());
    const p = claudeCliProvider({
      cliPath: "/bin/claude",
      configDir: "/home/aisys/.claude-sub",
      run: r.run,
      env: {
        PATH: "/usr/bin",
        HOME: "/home/aisys",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: "http://x",
        SECRET: "s",
      },
    });
    expect(p.billing).toBe("subscription");
    expect(p.key).toBe("claude-sub");
    const out = await p.complete(req());
    expect(out).toEqual({
      ok: true,
      text: "xin chào",
      model: "claude-sonnet-5-5",
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 1 },
    });
    const [argv, o] = r.calls[0] ?? [];
    expect(argv).toEqual(["/bin/claude", ...cliArgs("claude-sonnet-5-5", "hệ thống")]);
    expect(argv).toContain("--no-session-persistence");
    expect(argv?.slice(argv.indexOf("--tools"), argv.indexOf("--tools") + 2)).toEqual([
      "--tools",
      "",
    ]);
    expect(o?.stdin).toBe("câu hỏi");
    expect(o?.env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/aisys",
      CLAUDE_CONFIG_DIR: "/home/aisys/.claude-sub",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "777",
    });
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "SECRET"])
      expect(o?.env[k]).toBeUndefined();
  });

  test("chưa đăng nhập ⇒ UNAVAILABLE (JSON lỗi hoặc stderr); lỗi khác ⇒ FAILED; runner ném ⇒ FAILED", async () => {
    const authJson = ok({ is_error: true, result: "Not logged in · Please run /login" });
    expect(replyOf({ ...authJson, exitCode: 1 }, "m")).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(replyOf({ exitCode: 1, stdout: "", stderr: "Please run /login" }, "m")).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(replyOf({ exitCode: 1, stdout: "not json", stderr: "boom" }, "m")).toEqual({
      ok: false,
      code: "FAILED",
    });
    expect(
      replyOf(ok({ subtype: "error_max_turns", is_error: true, result: "" }), "m"),
    ).toMatchObject({
      ok: false,
      code: "FAILED",
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    expect(replyOf(ok({ modelUsage: undefined }), "asked")).toMatchObject({
      ok: true,
      model: "asked",
    });
    const p = claudeCliProvider({
      cliPath: "c",
      env: {},
      run: async () => {
        throw new Error("spawn");
      },
    });
    expect(await p.complete(req())).toEqual({ ok: false, code: "FAILED" });
  });

  test("lời nhắc hệ thống quá dài cho argv ⇒ FAILED, không chạy CLI", async () => {
    const r = recorder(() => ok());
    const p = claudeCliProvider({ cliPath: "c", env: {}, run: r.run });
    expect(await p.complete(req({ system: "x".repeat(SYSTEM_ARG_MAX + 1) }))).toEqual({
      ok: false,
      code: "FAILED",
    });
    expect(r.calls).toHaveLength(0);
  });

  test("giới hạn chạy cùng lúc: lượt 2 chờ lượt 1 xong; huỷ khi đang chờ ⇒ FAILED, không chạy", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((res) => {
      release = res;
    });
    let started = 0;
    let firstStarted: () => void = () => undefined;
    const firstIn = new Promise<void>((res) => {
      firstStarted = res;
    });
    const run: CliRun = async () => {
      started += 1;
      if (started === 1) {
        firstStarted();
        await held;
      }
      return ok();
    };
    const p = claudeCliProvider({ cliPath: "c", env: {}, run, maxConcurrency: 1 });
    const a = p.complete(req());
    await firstIn;
    const b = p.complete(req());
    const ac = new AbortController();
    const c = p.complete(req({ signal: ac.signal }));
    ac.abort();
    expect(await c).toEqual({ ok: false, code: "FAILED" });
    expect(started).toBe(1); // b vẫn chờ
    release();
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect(started).toBe(2); // c không bao giờ chạy
  });
});
