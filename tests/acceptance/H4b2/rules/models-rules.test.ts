// HUB-FR-66 · HUB-FR-67 · plan H4b2 §2.1 `models.rules.ts` · test-plan H4b2 §3 R01–R24: base URL (https; http chỉ
// dev + loopback), hình dạng provider theo loại, tham chiếu secret, readonly `dify`, thứ tự chặn xoá, bước profile,
// toàn subscription, trường đổi. Đỏ trước code: module chưa có ⇒ `qc: <hàm> chưa có`.
import { describe, expect, it } from "bun:test";
import { fn, loadModels } from "./_rules";

const DEV = { dev: true };
const PROD = { dev: false };
const m = await loadModels();
const baseUrlProblem = (raw: string | null, env = PROD) => fn(m, "baseUrlProblem")(raw, env);
const shape = (p: object, env = PROD) => fn(m, "providerShapeProblem")(p, env);
const ref = { id: "a4b20000-0000-4000-8000-000000000001", key: "smart" };
const S1 = "a4b20000-0000-4000-8000-000000000001";

describe("R01–R06 · baseUrlProblem [spec §3 BaseUrlSchema · plan §2.1]", () => {
  it("HUB-FR-66 · R01 · null và https hợp lệ (có path, có cổng) ⇒ null", () => {
    for (const u of [
      null,
      "https://api.anthropic.com",
      "https://proxy.example.test:8443/v1",
      "https://proxy.example.test/base/",
    ])
      expect([u, baseUrlProblem(u)]).toEqual([u, null]);
  });
  it("HUB-FR-66 · R02 · https có userinfo / query / hash ⇒ invalid", () => {
    for (const u of [
      "https://user:pw@api.example.test",
      "https://user@api.example.test",
      "https://api.example.test/v1?key=x",
      "https://api.example.test/v1#frag",
    ])
      expect([u, baseUrlProblem(u)]).toEqual([u, "invalid"]);
  });
  it("HUB-FR-66 · R03 · chuỗi không phải URL ⇒ invalid", () => {
    for (const u of ["api.example.test", "not a url", "https://"])
      expect([u, baseUrlProblem(u)]).toEqual([u, "invalid"]);
  });
  it("HUB-FR-66 · R04 · http ở production ⇒ not_https (kể cả loopback)", () => {
    for (const u of ["http://api.example.test", "http://localhost:8080", "http://127.0.0.1:9"])
      expect([u, baseUrlProblem(u, PROD)]).toEqual([u, "not_https"]);
  });
  it("HUB-FR-66 · R05 · http ở dev/test chỉ khi host loopback (localhost, 127.0.0.1, [::1]) ⇒ null", () => {
    for (const u of ["http://localhost:8080", "http://127.0.0.1:9/v1", "http://[::1]:3000"])
      expect([u, baseUrlProblem(u, DEV)]).toEqual([u, null]);
  });
  it("HUB-FR-66 · R06 · http ở dev/test host khác loopback ⇒ not_https", () => {
    for (const u of [
      "http://api.example.test",
      "http://10.0.0.5:8080",
      "http://localhost.evil.test",
    ])
      expect([u, baseUrlProblem(u, DEV)]).toEqual([u, "not_https"]);
  });
});

describe("R07–R11 · providerShapeProblem + secretRefProblem [spec §3 Hình dạng · plan §2.1]", () => {
  it("HUB-FR-66 · R07 · api thiếu secret_id ⇒ {secret_id, required}; api đủ ⇒ null", () => {
    expect(shape({ kind: "api", base_url: null, secret_id: null })).toEqual({
      path: "secret_id",
      reason: "required",
    });
    expect(shape({ kind: "api", base_url: "https://api.example.test", secret_id: S1 })).toBeNull();
  });
  it("HUB-FR-66 · R08 · subscription có secret_id ⇒ {secret_id, forbidden}; có base_url ⇒ {base_url, forbidden}; trống ⇒ null", () => {
    expect(shape({ kind: "subscription", base_url: null, secret_id: S1 })).toEqual({
      path: "secret_id",
      reason: "forbidden",
    });
    expect(
      shape({ kind: "subscription", base_url: "https://api.example.test", secret_id: null }),
    ).toEqual({ path: "base_url", reason: "forbidden" });
    expect(shape({ kind: "subscription", base_url: null, secret_id: null })).toBeNull();
  });
  it("HUB-FR-66 · R09 · api base_url sai ⇒ {base_url, invalid|not_https} theo env", () => {
    const p = (u: string, env = PROD) => shape({ kind: "api", base_url: u, secret_id: S1 }, env);
    expect(p("https://u:p@x.example.test")).toEqual({ path: "base_url", reason: "invalid" });
    expect(p("http://x.example.test")).toEqual({ path: "base_url", reason: "not_https" });
    expect(p("http://localhost:9", DEV)).toBeNull();
  });
  it("HUB-FR-66 · R10 · secretRefProblem: vắng ⇒ not_found; kind khác ⇒ wrong_kind; provider_api_key có tenant ⇒ wrong_kind; đúng ⇒ null", () => {
    const f = fn(m, "secretRefProblem");
    expect(f(undefined)).toBe("not_found");
    expect(f({ kind: "kh_api_key", tenantId: null })).toBe("wrong_kind");
    expect(f({ kind: "source_credential", tenantId: S1 })).toBe("wrong_kind");
    expect(f({ kind: "provider_api_key", tenantId: S1 })).toBe("wrong_kind");
    expect(f({ kind: "provider_api_key", tenantId: null })).toBeNull();
  });
  it("HUB-FR-66 · R11 · isReadonlyProvider: chỉ vendor dify", () => {
    const f = fn(m, "isReadonlyProvider");
    expect(["dify", "anthropic", "openai", "google", "fake"].map((v) => f(v))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("R12–R13 · providerDeleteBlock [spec §3 A DELETE · Q2 · plan §2.1]", () => {
  it("HUB-FR-66 · R12 · thứ tự: readonly > PROVIDER_IN_USE > PROVIDER_HAS_HISTORY", () => {
    const f = fn(m, "providerDeleteBlock");
    expect(f({ vendor: "dify", profiles: [ref], hasJobs: true })).toBe("PROVIDER_READONLY");
    expect(f({ vendor: "anthropic", profiles: [ref], hasJobs: true })).toBe("PROVIDER_IN_USE");
    expect(f({ vendor: "openai", profiles: [], hasJobs: true })).toBe("PROVIDER_HAS_HISTORY");
  });
  it("HUB-FR-66 · R13 · không profile, không job, không readonly ⇒ null", () => {
    expect(
      fn(m, "providerDeleteBlock")({ vendor: "fake", profiles: [], hasJobs: false }),
    ).toBeNull();
  });
});

const providers = new Map<string, { vendor: string }>([
  ["claude-sub", { vendor: "anthropic" }],
  ["openai-api", { vendor: "openai" }],
  ["fake-cli", { vendor: "fake" }],
  ["dify", { vendor: "dify" }],
]);
const st = (provider_key: string, on: string[] = [], model: string | null = null) => ({
  provider_key,
  model,
  on,
});

describe("R14–R19 · stepsProblem [spec §3 B Bước · plan §2.1]", () => {
  const f = (steps: object[]) => fn(m, "stepsProblem")(steps, providers);
  it("HUB-FR-67 · R14 · hợp lệ (cùng provider khác model được) ⇒ null", () => {
    expect(
      f([st("claude-sub", ["quota"], "sonnet"), st("claude-sub", [], "haiku"), st("fake-cli")]),
    ).toBeNull();
  });
  it("HUB-FR-67 · R15 · provider không có ở bước 1 ⇒ {index 1, not_found}", () => {
    expect(f([st("claude-sub"), st("khong-co")])).toEqual({ index: 1, reason: "not_found" });
  });
  it("HUB-FR-67 · R16 · provider dify (readonly) ⇒ {index 0, readonly}", () => {
    expect(f([st("dify"), st("fake-cli")])).toEqual({ index: 0, reason: "readonly" });
  });
  it("HUB-FR-67 · R17 · trùng (provider_key, model) ở bước 2 ⇒ {index 2, duplicate}", () => {
    expect(f([st("claude-sub", [], "m1"), st("fake-cli"), st("claude-sub", [], "m1")])).toEqual({
      index: 2,
      reason: "duplicate",
    });
    expect(f([st("fake-cli"), st("fake-cli")])).toEqual({ index: 1, reason: "duplicate" });
  });
  it("HUB-FR-67 · R18 · `on` trùng giá trị ⇒ {index, duplicate}", () => {
    expect(f([st("claude-sub", ["quota", "quota"]), st("fake-cli")])).toEqual({
      index: 0,
      reason: "duplicate",
    });
  });
  it("HUB-FR-67 · R19 · nhiều lỗi ⇒ lỗi đầu tiên theo thứ tự bước", () => {
    expect(f([st("fake-cli"), st("dify"), st("khong-co")])).toEqual({
      index: 1,
      reason: "readonly",
    });
  });
});

describe("R20–R24 · allSubscription + providerChanged [spec §3 B · AC-H04 cảnh báo · plan §2.1]", () => {
  const kinds: Record<string, string> = {
    "claude-sub": "subscription",
    "fake-cli": "subscription",
    "openai-api": "api",
  };
  const kindOf = (k: string) => kinds[k];
  it("HUB-FR-67 · R20 · mọi bước subscription ⇒ true", () => {
    expect(fn(m, "allSubscription")([st("claude-sub"), st("fake-cli")], kindOf)).toBe(true);
  });
  it("HUB-FR-67 · R21 · có một bước api ⇒ false; provider không có ⇒ không tính là subscription", () => {
    const f = fn(m, "allSubscription");
    expect(f([st("claude-sub"), st("openai-api")], kindOf)).toBe(false);
    expect(f([st("claude-sub"), st("khong-co")], kindOf)).toBe(false);
  });
  const base = {
    base_url: null as string | null,
    secret_id: S1 as string | null,
    max_concurrency: 1,
    enabled: true,
  };
  it("HUB-FR-66 · R22 · không đổi ⇒ []", () => {
    expect(fn(m, "providerChanged")(base, { ...base })).toEqual([]);
  });
  it("HUB-FR-66 · R23 · đổi enabled + base_url ⇒ đúng hai trường", () => {
    const got = fn(m, "providerChanged")(base, {
      ...base,
      enabled: false,
      base_url: "https://x.example.test",
    }) as string[];
    expect([...got].sort()).toEqual(["base_url", "enabled"]);
  });
  it("HUB-FR-66 · R24 · đổi secret_id + max_concurrency ⇒ đúng hai trường", () => {
    const got = fn(m, "providerChanged")(base, {
      ...base,
      secret_id: null,
      max_concurrency: 3,
    }) as string[];
    expect([...got].sort()).toEqual(["max_concurrency", "secret_id"]);
  });
});
