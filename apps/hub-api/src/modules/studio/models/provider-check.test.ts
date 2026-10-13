// HUB-FR-66 · AC-H4b2-02 · plan H4b2 §3.2, D8, D13 · unit `ProviderCheckService` không DB: `apiCheck` (reader secret giả,
// `fetch` giả) và `pollProbe` (đọc state giả, đồng hồ giả). Ca có DB (404, readonly, audit, xoá mốc probe): int C01–C14.
import { describe, expect, test } from "bun:test";
import type { Db } from "../../../lib/db";
import { SecretUseError, type SecretUseFailure } from "../../secrets/secrets.use";
import { PROBE_POLL_MS, ProviderCheckService, readLimited } from "./provider-check";
import type { ProbeStateRow } from "./provider-check.repo";

const KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx0123456789";
type Call = { url: string; init: RequestInit };

function svc(
  o: { key?: string; fail?: SecretUseFailure; respond?: (url: string) => Response } = {},
) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let t = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return (o.respond ?? (() => new Response("{}", { status: 200 })))(url);
  }) as unknown as typeof fetch;
  const s = new ProviderCheckService({
    db: {} as Db,
    audit: { insert: async () => {} },
    reader: {
      async useSecret(_ref, fn) {
        if (o.fail) throw new SecretUseError(o.fail);
        return fn(o.key ?? KEY);
      },
    },
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    log: { info: () => {} },
    clock: () => t,
    now: () => new Date("2026-10-13T08:00:00Z"),
  });
  return { s, calls, sleeps };
}
const row = (vendor: string, baseUrl: string | null = null) => ({
  id: "p1",
  key: "p",
  kind: "api" as const,
  vendor,
  baseUrl,
  secretId: "s1",
});

describe("ProviderCheckService.apiCheck", () => {
  test("HUB-FR-66 · D8 · fake `fake-ok…` ⇒ ok 200, không fetch", async () => {
    const { s, calls } = svc({ key: "fake-ok-1" });
    expect(await s.apiCheck(row("fake"))).toMatchObject({ status: "ok", http_status: 200 });
    expect(calls).toEqual([]);
  });
  test("HUB-FR-66 · fake key khác ⇒ auth_failed 401, message nguyên văn", async () => {
    const { s } = svc({ key: "fake-bad-1" });
    expect(await s.apiCheck(row("fake"))).toMatchObject({
      status: "error",
      error_code: "auth_failed",
      http_status: 401,
      message: "invalid x-api-key (fake)",
    });
  });
  test("HUB-FR-66 · D13 · openai vọng key ⇒ message che, request redirect error + signal + Bearer", async () => {
    const body = JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.` } });
    const { s, calls } = svc({ respond: () => new Response(body, { status: 401 }) });
    const r = await s.apiCheck(row("openai"));
    expect(r).toMatchObject({ status: "error", error_code: "auth_failed", http_status: 401 });
    expect(r.message).toContain("***");
    expect(JSON.stringify(r)).not.toContain(KEY.slice(8, 16));
    const c = calls[0];
    expect(c?.url).toBe("https://api.openai.com/v1/models");
    expect(c?.init.redirect).toBe("error");
    expect(c?.init.signal).toBeInstanceOf(AbortSignal);
    expect((c?.init.headers as Record<string, string> | undefined)?.Authorization).toBe(
      `Bearer ${KEY}`,
    );
  });
});

describe("ProviderCheckService.apiCheck · lỗi", () => {
  test("HUB-FR-66 · fetch ném TimeoutError ⇒ timeout; TypeError ⇒ network; http_status null", async () => {
    const a = svc({
      respond: () => {
        throw new DOMException("t", "TimeoutError");
      },
    });
    expect(await a.s.apiCheck(row("anthropic"))).toMatchObject({
      error_code: "timeout",
      http_status: null,
    });
    const b = svc({
      respond: () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await b.s.apiCheck(row("google"))).toMatchObject({ error_code: "network" });
  });
  test("HUB-FR-66 · vendor không trong bảng ⇒ unsupported, latency null, không fetch", async () => {
    const { s, calls } = svc();
    expect(await s.apiCheck(row("mistral"))).toMatchObject({
      status: "unsupported",
      latency_ms: null,
    });
    expect(calls).toEqual([]);
  });
  test("HUB-FR-66 · secret giải mã lỗi ⇒ secret_unreadable; thiếu khoá Hub ⇒ 409 NOT_CONFIGURED", async () => {
    const { s, calls } = svc({ fail: "decrypt_failed" });
    expect(await s.apiCheck(row("openai"))).toMatchObject({
      status: "error",
      error_code: "secret_unreadable",
      latency_ms: null,
    });
    expect(calls).toEqual([]);
    await expect(svc({ fail: "key_missing" }).s.apiCheck(row("openai"))).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      status: 409,
    });
  });
});

describe("ProviderCheckService.pollProbe", () => {
  const t0 = new Date("2026-10-13T08:00:00.000Z");
  const later = new Date("2026-10-13T08:00:01.000Z");
  test("HUB-FR-66 · probe mới logged_out ⇒ error + last_error; latency theo đồng hồ", async () => {
    const { s, sleeps } = svc();
    let n = 0;
    const read = async (): Promise<ProbeStateRow> =>
      ++n < 3
        ? { status: "ok", lastProbeAt: null, lastError: null }
        : { status: "logged_out", lastProbeAt: later, lastError: "Not logged in" };
    const r = await s.pollProbe(read, t0);
    expect(r).toMatchObject({ status: "error", message: "Not logged in", error_code: null });
    expect(r.latency_ms).toBe(3 * PROBE_POLL_MS);
    expect(sleeps).toEqual([500, 500, 500]);
  });
  test("HUB-FR-66 · probe cũ (< t0) không tính; hết 10 s ⇒ requested", async () => {
    const { s, sleeps } = svc();
    const old = { status: "ok", lastProbeAt: new Date("2026-10-13T07:00:00Z"), lastError: null };
    const r = await s.pollProbe(async () => old, t0);
    expect(r).toMatchObject({ status: "requested", error_code: null, http_status: null });
    expect(sleeps.length).toBe(20);
    expect(r.latency_ms).toBe(10_000);
  });
  test("HUB-FR-66 · busy ⇒ ok", async () => {
    const { s } = svc();
    const r = await s.pollProbe(
      async () => ({ status: "busy", lastProbeAt: later, lastError: null }),
      t0,
    );
    expect(r.status).toBe("ok");
  });
});

describe("readLimited", () => {
  test("HUB-FR-66 · cắt ở giới hạn byte", async () => {
    expect(await readLimited(new Response("x".repeat(100)), 10)).toBe("x".repeat(10));
    expect(await readLimited(new Response(null))).toBe("");
  });
});
