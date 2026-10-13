// HUB-FR-66 · AC-H4b2-02 · plan H4b2 §2.2 `provider-check.rules.ts` · test-plan H4b2 §3 R30–R47: bảng hãng (Q3),
// vendor `fake` trong tiến trình, che key (`redactKey`), thông điệp lỗi nguyên văn ≤ 500, kết quả `ProviderCheckResult`.
// Đỏ trước code: module chưa có ⇒ `qc: <hàm> chưa có`.
import { describe, expect, it } from "bun:test";
import { fn, loadCheck, loadStudio } from "./_rules";

const m = await loadCheck();
const KEY = "sk-proj-qcH4B2abcdefgh12345678XYZ";
const NOW = new Date("2026-10-13T08:10:00.000Z");

describe("R30–R35 · vendorCheckRequest + fakeCheck [Q3 · plan §2.2 · D8]", () => {
  it("HUB-FR-66 · R30 · CHECK_TIMEOUT_MS = 10 000", () => {
    expect(m.CHECK_TIMEOUT_MS).toBe(10_000);
  });
  it("HUB-FR-66 · R31 · anthropic: GET https://api.anthropic.com/v1/models, x-api-key + anthropic-version 2023-06-01", () => {
    const r = fn(m, "vendorCheckRequest")("anthropic", null, KEY);
    expect(r.url).toBe("https://api.anthropic.com/v1/models");
    expect(r.headers).toMatchObject({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
  });
  it("HUB-FR-66 · R32 · openai: GET https://api.openai.com/v1/models, Authorization Bearer", () => {
    const r = fn(m, "vendorCheckRequest")("openai", null, KEY);
    expect(r.url).toBe("https://api.openai.com/v1/models");
    expect(r.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
  });
  it("HUB-FR-66 · R33 · google: v1beta/models, x-goog-api-key, KHÔNG có key trong URL", () => {
    const r = fn(m, "vendorCheckRequest")("google", null, KEY);
    expect(r.url).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(r.headers).toMatchObject({ "x-goog-api-key": KEY });
    expect(r.url).not.toContain(KEY);
  });
  it("HUB-FR-66 · R34 · base_url thay gốc mặc định; vendor dify / lạ ⇒ null (unsupported)", () => {
    const f = fn(m, "vendorCheckRequest");
    expect(f("openai", "https://proxy.example.test", KEY).url).toBe(
      "https://proxy.example.test/v1/models",
    );
    expect(f("dify", null, KEY)).toBeNull();
    expect(f("mistral", null, KEY)).toBeNull();
  });
  it("HUB-FR-66 · R35 · fakeCheck: `fake-ok…` ⇒ 200; khác ⇒ 401 invalid x-api-key (fake)", () => {
    const f = fn(m, "fakeCheck");
    expect(f("fake-ok-123")).toEqual({ status: 200, body: "{}" });
    const bad = f("fake-bad-123");
    expect(bad.status).toBe(401);
    expect(JSON.parse(bad.body)).toEqual({ error: { message: "invalid x-api-key (fake)" } });
    expect(f("sk-fake-ok").status).toBe(401);
  });
});

describe("R36–R41 · redactKey + errorMessageOf [D13 · plan §2.2, §5]", () => {
  it("HUB-FR-66 · R36 · mọi lần xuất hiện của key ⇒ ***", () => {
    const out = fn(m, "redactKey")(`a ${KEY} b ${KEY}`, KEY);
    expect(out).not.toContain(KEY);
    expect(out.split("***").length - 1).toBeGreaterThanOrEqual(2);
  });
  it("HUB-FR-66 · R37 · chuỗi con ≥ 8 ký tự liền của key (OpenAI vọng key che một phần) ⇒ không còn", () => {
    const echo = `Incorrect API key provided: sk-proj-****${KEY.slice(-12)}. You can find your key`;
    const out: string = fn(m, "redactKey")(echo, KEY);
    for (let i = 0; i + 8 <= KEY.length; i++) expect(out).not.toContain(KEY.slice(i, i + 8));
    expect(out).toContain("***");
    expect(out).toContain("Incorrect API key provided");
  });
  it("HUB-FR-66 · R38 · mẫu sk-/sk_/AIza dù không phải key đang kiểm ⇒ ***; chữ thường giữ nguyên", () => {
    const f = fn(m, "redactKey");
    expect(f("other sk-abcdef123456 here", KEY)).not.toContain("sk-abcdef123456");
    expect(f("other sk_live_abcdef here", KEY)).not.toContain("sk_live_abcdef");
    expect(f("g AIzaSyQc12345678 x", KEY)).not.toContain("AIzaSyQc12345678");
    expect(f("model not found", KEY)).toBe("model not found");
  });
  it("HUB-FR-66 · R39 · errorMessageOf: {error:{message}} | {error:string} | {message} | text thô", () => {
    const f = fn(m, "errorMessageOf");
    expect(f('{"error":{"message":"invalid x-api-key"}}', KEY)).toBe("invalid x-api-key");
    expect(f('{"error":"quota exceeded"}', KEY)).toBe("quota exceeded");
    expect(f('{"message":"Forbidden"}', KEY)).toBe("Forbidden");
    expect(f("502 Bad Gateway", KEY)).toBe("502 Bad Gateway");
  });
  it("HUB-FR-66 · R40 · errorMessageOf che key + cắt 500; rỗng ⇒ null", () => {
    const f = fn(m, "errorMessageOf");
    const got: string = f(JSON.stringify({ error: { message: `bad key ${KEY}` } }), KEY);
    expect(got).not.toContain(KEY);
    expect(got).toContain("bad key");
    expect((f("x".repeat(900), KEY) as string).length).toBe(500);
    expect(f("", KEY)).toBeNull();
  });
  it("HUB-FR-66 · R41 · key ngắn hơn 8 ký tự vẫn được che toàn bộ", () => {
    expect(fn(m, "redactKey")("key=abc123 end", "abc123")).not.toContain("abc123");
  });
});

describe("R42–R47 · checkOutcome [spec §3 ProviderCheckResult · plan §2.2]", () => {
  const out = (hit: unknown, ms = 120) => fn(m, "checkOutcome")(hit, KEY, ms, NOW);
  it("HUB-FR-66 · R42 · 2xx ⇒ ok, error_code null, http_status 200, latency, checked_at", () => {
    expect(out({ status: 200, body: "{}" })).toMatchObject({
      status: "ok",
      error_code: null,
      http_status: 200,
      latency_ms: 120,
      checked_at: NOW.toISOString(),
    });
  });
  it("HUB-FR-66 · R43 · 401 và 403 ⇒ error/auth_failed + message nguyên văn đã che", () => {
    for (const s of [401, 403]) {
      const r = out({
        status: s,
        body: `{"error":{"message":"Incorrect API key provided: ${KEY}"}}`,
      });
      expect(r).toMatchObject({ status: "error", error_code: "auth_failed", http_status: s });
      expect(r.message).toContain("Incorrect API key provided");
      expect(r.message).not.toContain(KEY);
    }
  });
  it("HUB-FR-66 · R44 · mã khác (429, 500) ⇒ error/http_error", () => {
    for (const s of [429, 500])
      expect(out({ status: s, body: "Too Many" })).toMatchObject({
        status: "error",
        error_code: "http_error",
        http_status: s,
        message: "Too Many",
      });
  });
  it('HUB-FR-66 · R45 · "timeout" / "network" ⇒ error/<đó>, http_status null', () => {
    expect(out("timeout")).toMatchObject({
      status: "error",
      error_code: "timeout",
      http_status: null,
    });
    expect(out("network")).toMatchObject({
      status: "error",
      error_code: "network",
      http_status: null,
    });
  });
  it("HUB-FR-66 · R46 · message ≤ 500 ký tự", () => {
    const r = out({ status: 500, body: "e".repeat(2000) });
    expect(r.message.length).toBeLessThanOrEqual(500);
  });
  it("HUB-FR-66 · R47 · mọi kết quả hợp `ProviderCheckResultSchema` (contract strict)", async () => {
    const c = await loadStudio();
    expect(typeof c.ProviderCheckResultSchema?.safeParse).toBe("function");
    for (const hit of [
      { status: 200, body: "{}" },
      { status: 401, body: "x" },
      "timeout",
      "network",
    ])
      expect(c.ProviderCheckResultSchema.safeParse(out(hit)).success).toBe(true);
  });
});
