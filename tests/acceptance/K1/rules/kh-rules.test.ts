// HUB-FR-131 · HUB-FR-134 · HUB-FR-137 · HUB-BR-35 · HUB-BR-37 · HUB-BR-40 · plan §2.1 `kh.rules.ts` · test-plan K1 §4 R01–R24:
// chính sách URL (https, localhost dev, allowlist, cấm userinfo/query/fragment), phiên bản ≥ 6.4, credentials JSON, token_url,
// people lanes (Q2), tenant hiệu lực (Q5), khoá step (D13), làm mới token 60–90 s, phân loại lỗi KH (plan §3.3), lùi ghi,
// quyền quản lý, snapshot audit. Module chưa có ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import { fn, loadRules } from "./_rules";

const m = await loadRules();
const ALLOW = [
  "https://kh.example.com",
  "http://localhost:4030",
  "http://127.0.0.1:4030",
  "http://[::1]:4030",
];

describe("R01–R06 · khUrlPolicy [spec §3.5 · HUB-BR-37]", () => {
  const pol = (raw: string, appEnv = "production", allowedOrigins: string[] = ALLOW) =>
    fn(m, "khUrlPolicy")(raw, { allowedOrigins, appEnv });
  it("HUB-BR-37 · R01 · https trong allowlist ⇒ ok, bỏ '/' cuối, localDev=false", () => {
    expect(pol("https://kh.example.com/")).toEqual({
      ok: true,
      baseUrl: "https://kh.example.com",
      localDev: false,
    });
    const p = pol("https://kh.example.com/base/");
    expect(p.ok).toBe(true);
    expect(String(p.baseUrl).endsWith("/base")).toBe(true);
  });
  it("HUB-BR-37 · R02 · so origin chuẩn hoá: host chữ hoa + cổng mặc định 443 ⇒ ok; cổng khác ⇒ not_in_allowlist", () => {
    expect(pol("https://KH.Example.com:443").ok).toBe(true);
    expect(pol("https://kh.example.com:8443")).toEqual({ ok: false, reason: "not_in_allowlist" });
    expect(pol("https://other.example.com")).toEqual({ ok: false, reason: "not_in_allowlist" });
    expect(pol("https://kh.example.com", "production", [])).toEqual({
      ok: false,
      reason: "not_in_allowlist",
    });
  });
  it("HUB-BR-37 · R03 · http localhost/127.0.0.1/::1 chỉ khi development|test ⇒ ok + localDev=true", () => {
    for (const env of ["development", "test"]) {
      expect(pol("http://localhost:4030", env)).toEqual({
        ok: true,
        baseUrl: "http://localhost:4030",
        localDev: true,
      });
      expect(pol("http://127.0.0.1:4030", env).localDev).toBe(true);
      expect(pol("http://[::1]:4030", env).ok).toBe(true);
    }
  });
  it("HUB-BR-37 · R04 · http ở production (kể cả localhost) hoặc host thường ⇒ not_https", () => {
    expect(pol("http://localhost:4030", "production")).toEqual({ ok: false, reason: "not_https" });
    expect(
      pol("http://kh.example.com", "development", [...ALLOW, "http://kh.example.com"]),
    ).toEqual({
      ok: false,
      reason: "not_https",
    });
  });
  it("HUB-BR-37 · R05 · userinfo / query / fragment / không phải URL ⇒ invalid", () => {
    for (const raw of [
      "https://user:pw@kh.example.com",
      "https://kh.example.com/?a=1",
      "https://kh.example.com/#x",
      "không phải url",
      "",
    ])
      expect({ raw, r: pol(raw) }).toEqual({ raw, r: { ok: false, reason: "invalid" } });
  });
  it("HUB-BR-37 · R06 · scheme khác http/https ⇒ không ok", () => {
    expect(pol("ftp://kh.example.com").ok).toBe(false);
  });
});

describe("R07–R09 · phiên bản + credentials [spec §2 · plan D11]", () => {
  it("HUB-FR-131 · R07 · parseKhVersion: v6.4/6.4.1/6.10 ⇒ [major, minor]; rác ⇒ null", () => {
    const p = fn(m, "parseKhVersion");
    expect([p("v6.4"), p("6.4.1"), p("6.10"), p("v7.0")]).toEqual([
      [6, 4],
      [6, 4],
      [6, 10],
      [7, 0],
    ]);
    expect([p("abc"), p(null), p(undefined), p({}), p("")]).toEqual([null, null, null, null, null]);
  });
  it("HUB-FR-131 · R08 · khVersionOk ≥ 6.4 (6.10 > 6.4 theo số, không theo chuỗi)", () => {
    const ok = fn(m, "khVersionOk");
    expect([ok("v6.4"), ok("6.10"), ok("v7.0"), ok("6.4.9")]).toEqual([true, true, true, true]);
    expect([ok("v6.3"), ok("6.3.9"), ok("v5.9"), ok(null), ok("x")]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
  it("HUB-FR-137 · HUB-BR-36 · R09 · parseKhCredentials: JSON hợp lệ ⇒ {clientId, clientSecret, tokenUrl}; sai ⇒ null, không ném", () => {
    const p = fn(m, "parseKhCredentials");
    expect(p('{"client_id":"kh-ns-acme_ns","client_secret":"s3cret"}')).toEqual({
      clientId: "kh-ns-acme_ns",
      clientSecret: "s3cret",
      tokenUrl: null,
    });
    expect(
      p('{"client_id":"c","client_secret":"s","token_url":"https://idp.example.com/token"}'),
    ).toEqual({
      clientId: "c",
      clientSecret: "s",
      tokenUrl: "https://idp.example.com/token",
    });
    for (const raw of [
      "không phải json",
      "[]",
      "null",
      '{"client_id":"","client_secret":"s"}',
      '{"client_id":"c"}',
      `{"client_id":"${"c".repeat(129)}","client_secret":"s"}`,
      `{"client_id":"c","client_secret":"${"s".repeat(513)}"}`,
      '{"client_id":"c","client_secret":"s","token_url":"không-url"}',
    ])
      expect({ raw: raw.slice(0, 40), v: p(raw) }).toEqual({ raw: raw.slice(0, 40), v: null });
  });
  it("HUB-FR-137 · R10 · tokenUrlOf: mặc định <base>/v1/token, có token_url ⇒ dùng token_url", () => {
    const t = fn(m, "tokenUrlOf");
    expect(t("https://kh.example.com", { clientId: "c", clientSecret: "s", tokenUrl: null })).toBe(
      "https://kh.example.com/v1/token",
    );
    expect(
      t("https://kh.example.com", {
        clientId: "c",
        clientSecret: "s",
        tokenUrl: "https://idp.example.com/t",
      }),
    ).toBe("https://idp.example.com/t");
  });
});

describe("R11–R13 · people lanes, hiệu lực, khoá step [Q2 · Q5 · D13]", () => {
  it("HUB-BR-40 · Q2 · R11 · peopleLanesOn(manifest): bật trừ khi === false; retrieval.include_people_lanes ghi đè", () => {
    const on = fn(m, "peopleLanesOn");
    expect(on({ settings: { include_people_lanes: false } })).toBe(false);
    expect(on({ settings: {} })).toBe(true);
    expect(on({})).toBe(true);
    expect(on({ settings: { include_people_lanes: true } })).toBe(true);
    expect(
      on({ settings: { include_people_lanes: false, retrieval: { include_people_lanes: true } } }),
    ).toBe(true);
    expect(
      on({ settings: { include_people_lanes: true, retrieval: { include_people_lanes: false } } }),
    ).toBe(false);
  });
  it("HUB-BR-35 · Q5 · R12 · khEffective: đủ base_url + secret + enabled + status ok mới true", () => {
    const e = fn(m, "khEffective");
    const full = { baseUrl: "https://kh.example.com", secretId: "s1", enabled: true, status: "ok" };
    expect(e(full)).toBe(true);
    expect([
      e(null),
      e({ ...full, baseUrl: null }),
      e({ ...full, secretId: null }),
      e({ ...full, enabled: false }),
      e({ ...full, status: "unchecked" }),
      e({ ...full, status: "error" }),
    ]).toEqual([false, false, false, false, false, false]);
  });
  it("HUB-FR-132 · D13 · R13 · khStepKey: chỉ chiều có trong keyspace_dims (role→agent, step→stage, process→quy trình)", () => {
    const k = fn(m, "khStepKey");
    const c = { agentKey: "hd-read", stageKey: "g0", processKey: "k1-gate" };
    expect(k(["role", "step"], c)).toEqual({ role: "hd-read", step: "g0" });
    expect(k(["role", "step", "process"], c)).toEqual({
      role: "hd-read",
      step: "g0",
      process: "k1-gate",
    });
    expect(k(["stack", "step"], c)).toEqual({ step: "g0" });
    expect(k([], c)).toEqual({});
  });
});

describe("R14–R15 · làm mới token [HUB-FR-137]", () => {
  it("HUB-FR-137 · R14 · tokenFresh: còn trước expiresAt − lead ⇒ true; từ mốc đó ⇒ false", () => {
    const f = fn(m, "tokenFresh");
    const e = { expiresAtMs: 1_000_000, leadMs: 60_000 };
    expect([f(e, 939_999), f(e, 940_000), f(e, 1_000_001)]).toEqual([true, false, false]);
  });
  it("HUB-FR-137 · R15 · tokenLeadMs = 60 000 + jitter 0..30 000 (rand 0 ⇒ 60 s, 0.5 ⇒ 75 s, ~1 ⇒ < 90 s)", () => {
    const l = fn(m, "tokenLeadMs");
    expect(l(() => 0)).toBe(60_000);
    expect(l(() => 0.5)).toBe(75_000);
    const hi = l(() => 0.999999);
    expect(hi >= 89_000 && hi <= 90_000).toBe(true);
  });
});

describe("R16–R20 · phân loại lỗi KH [plan §3.3 · HUB-FR-134]", () => {
  const cases: [number | "timeout" | "network", unknown, string, string][] = [
    ["network", null, "unreachable", "later"],
    ["timeout", null, "timeout", "later"],
    [401, { detail: "token expired" }, "unauthorized", "refresh_once"],
    [403, { error: "forbidden", detail: "x" }, "forbidden", "never"],
    [404, { error: "ns_not_active" }, "ns_not_active", "later"],
    [404, { error: "not_found" }, "invalid", "never"],
    [404, null, "invalid", "never"],
    [422, { error: "invalid" }, "invalid", "never"],
    [413, { error: "too_large" }, "invalid", "never"],
    [400, null, "invalid", "never"],
    [423, { error: "ns_suspended" }, "ns_suspended", "later"],
    [409, { error: "in_progress" }, "in_progress", "soon"],
    [429, { error: "quota" }, "quota", "later"],
    [503, { error: "embedder_unavailable" }, "embedder_unavailable", "later"],
    [503, { detail: "x" }, "server_error", "later"],
    [500, null, "server_error", "later"],
    [502, null, "server_error", "later"],
  ];
  for (const [status, body, code, retry] of cases)
    it(`HUB-FR-134 · R16 · classifyKhFailure(${status}, ${JSON.stringify(body)}) ⇒ ${code}/${retry}`, () => {
      expect(fn(m, "classifyKhFailure")(status, body)).toEqual({ code, retry });
    });
  it("HUB-FR-133 · R17 · writeBackoffMs = 30 000 × 2^(n−1); KH_WRITE_MAX_ATTEMPTS = 5", () => {
    const b = fn(m, "writeBackoffMs");
    expect([b(1), b(2), b(3), b(4)]).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(m.KH_WRITE_MAX_ATTEMPTS).toBe(5);
  });
});

describe("R21–R22 · quyền + audit [spec §3.2–3.3 · §3.6]", () => {
  it("HUB-FR-131 · HUB-FR-132 · R21 · canManageKh: studio chỉ platform_admin; tenant: tenant_admin|platform_admin; member không", () => {
    const c = fn(m, "canManageKh");
    expect([
      c("platform_admin", "studio"),
      c("tenant_admin", "studio"),
      c("member", "studio"),
      c("platform_admin", "tenant"),
      c("tenant_admin", "tenant"),
      c("member", "tenant"),
    ]).toEqual([true, false, false, true, true, false]);
  });
  it("HUB-BR-36 · R22 · khAuditSnapshot có ns/secret_id/keyspace/projects/enabled/version, không có giá trị secret", () => {
    const s = fn(
      m,
      "khAuditSnapshot",
    )({
      ns: "acme_ns",
      secretId: "c1a10000-0000-4000-8000-000000000001",
      keyspace: "step",
      projects: [{ project_id: "proj-a", label: "A", read_only: false }],
      enabled: true,
      version: 3,
    });
    const txt = JSON.stringify(s);
    for (const v of ["acme_ns", "c1a10000-0000-4000-8000-000000000001", "step", "proj-a"])
      expect({ v, has: txt.includes(v) }).toEqual({ v, has: true });
    for (const bad of ["client_secret", "access_token", "ciphertext"])
      expect({ bad, has: txt.includes(bad) }).toEqual({ bad, has: false });
  });
});
