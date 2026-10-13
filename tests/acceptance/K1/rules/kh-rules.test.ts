// HUB-FR-131 · HUB-FR-134 · HUB-BR-37 · HUB-BR-40 · CR-073 · plan K1 §2.1 (`kh.rules.ts`) · spec §3.4 (URL), §2 (hạ cấp) ·
// test-plan K1 §4 R01–R11: chính sách URL KH (https / loopback dev / allowlist / userinfo-query-fragment), phiên bản ≥ v6.4,
// "dùng được", danh sách project từ `GET /projects`, embedder chỉ tiếng Anh, phân loại lỗi hạ cấp, thử lại ghi + lùi,
// audit kết nối không mang khoá. Module vắng ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import { fn, loadRules } from "./_rules";

const m = await loadRules();
const ALLOWED = ["https://kh.example.com", "http://localhost:4030", "http://127.0.0.1:4030"];

describe("R01–R03 · khUrlPolicy [spec §3.4 · HUB-BR-37]", () => {
  it("HUB-FR-131 · HUB-BR-37 · R01 · https trong allowlist ⇒ ok, bỏ '/' cuối, localDev false; có đường dẫn giữ nguyên", () => {
    const f = fn(m, "khUrlPolicy");
    expect(f("https://kh.example.com/", ALLOWED, { dev: false })).toEqual({
      ok: true,
      baseUrl: "https://kh.example.com",
      localDev: false,
    });
    expect(f("https://kh.example.com/kh", ALLOWED, { dev: false })).toEqual({
      ok: true,
      baseUrl: "https://kh.example.com/kh",
      localDev: false,
    });
  });
  it("HUB-BR-37 · R02 · http chỉ khi dev ∧ loopback (localDev true); dev tắt hoặc host không loopback ⇒ not_https", () => {
    const f = fn(m, "khUrlPolicy");
    for (const u of ["http://localhost:4030", "http://127.0.0.1:4030/"])
      expect({ u, r: f(u, ALLOWED, { dev: true }) }).toEqual({
        u,
        r: { ok: true, baseUrl: u.replace(/\/$/, ""), localDev: true },
      });
    expect(f("http://localhost:4030", ALLOWED, { dev: false })).toEqual({
      ok: false,
      reason: "not_https",
    });
    expect(
      f("http://kh.example.com", [...ALLOWED, "http://kh.example.com"], { dev: true }),
    ).toEqual({ ok: false, reason: "not_https" });
  });
  it("HUB-BR-37 · R03 · origin ngoài allowlist ⇒ not_in_allowlist; userinfo/query/fragment/chuỗi rác ⇒ invalid", () => {
    const f = fn(m, "khUrlPolicy");
    expect(f("https://evil.example.com", ALLOWED, { dev: false })).toEqual({
      ok: false,
      reason: "not_in_allowlist",
    });
    expect(f("https://kh.example.com", [], { dev: false })).toEqual({
      ok: false,
      reason: "not_in_allowlist",
    });
    for (const u of [
      "https://user:pw@kh.example.com",
      "https://kh.example.com/?a=1",
      "https://kh.example.com/#x",
      "kh.example.com",
      "",
    ])
      expect({ u, r: f(u, ALLOWED, { dev: false }) }).toEqual({
        u,
        r: { ok: false, reason: "invalid" },
      });
  });
});

describe("R04–R07 · phiên bản, dùng được, project, embedder [spec §3.0 · Q31 · Q33 · Q34]", () => {
  it("HUB-FR-131 · R04 · parseKhVersion 'v6.4' | '6.4.1' ⇒ [6,4]; khác ⇒ null; khVersionOk ≥ 6.4", () => {
    const p = fn(m, "parseKhVersion");
    const okV = fn(m, "khVersionOk");
    expect(p("v6.4")).toEqual([6, 4]);
    expect(p("6.4.1")).toEqual([6, 4]);
    expect(p("v7.0")).toEqual([7, 0]);
    for (const v of ["abc", "", null, undefined, 6.4, {}]) expect(p(v)).toBeNull();
    expect([okV([6, 4]), okV([6, 10]), okV([7, 0])]).toEqual([true, true, true]);
    expect([okV([6, 3]), okV([5, 9]), okV(null)]).toEqual([false, false, false]);
  });
  it("HUB-FR-132 · Q34 · R05 · khConnectionUsable: chỉ checkStatus 'ok'", () => {
    const f = fn(m, "khConnectionUsable");
    expect(f({ checkStatus: "ok" })).toBe(true);
    expect([f({ checkStatus: "unchecked" }), f({ checkStatus: "error" })]).toEqual([false, false]);
  });
  it("HUB-FR-132 · Q31 · R06 · parseKhProjects: khoá object `projects` hợp lệ KhProjectId, sắp tăng, bỏ trùng; không phải object ⇒ null", () => {
    const f = fn(m, "parseKhProjects");
    expect(
      f({ version: 1, projects: { "proj-b": {}, "proj-a": { x: 1 }, "bad/x": {}, "-x": {} } }),
    ).toEqual(["proj-a", "proj-b"]);
    expect(f({ projects: {} })).toEqual([]);
    for (const b of [null, {}, { projects: null }, { projects: "a" }, "x"])
      expect({ b, r: f(b) }).toEqual({ b, r: null });
  });
  it("HUB-FR-131 · Q33 · R07 · embedderEnglishOnly: tên có đoạn 'en' (-en, _en, /en, en.) ⇒ true; bge-m3, null ⇒ false", () => {
    const f = fn(m, "embedderEnglishOnly");
    for (const v of ["BAAI/bge-small-en-v1.5", "bge-base-en", "model_en", "en"])
      expect({ v, r: f(v) }).toEqual({ v, r: true });
    for (const v of ["BAAI/bge-m3", "bge-m3", "multilingual-e5-large", "english-model", null])
      expect({ v, r: f(v) }).toEqual({ v, r: false });
  });
});

describe("R08–R11 · hạ cấp, thử lại, audit [HUB-FR-134 · spec §3.4 · plan §4]", () => {
  it("HUB-FR-134 · R08 · classifyKhFailure theo bảng plan §2.1", () => {
    const f = fn(m, "classifyKhFailure");
    const table: [number | string, string][] = [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [400, "invalid"],
      [413, "invalid"],
      [422, "invalid"],
      [429, "rate_limited"],
      [500, "server_error"],
      [502, "server_error"],
      [503, "server_error"],
      [418, "server_error"],
      ["timeout", "timeout"],
      ["network", "unreachable"],
    ];
    for (const [i, want] of table) expect({ i, r: f(i) }).toEqual({ i, r: want });
  });
  it("HUB-FR-133 · R09 · khWriteRetryable: timeout/network/429/5xx ⇒ true; 4xx khác ⇒ false", () => {
    const f = fn(m, "khWriteRetryable");
    for (const i of ["timeout", "network", 429, 500, 503])
      expect({ i, r: f(i) }).toEqual({ i, r: true });
    for (const i of [400, 401, 403, 404, 422]) expect({ i, r: f(i) }).toEqual({ i, r: false });
  });
  it("HUB-FR-133 · R10 · writeBackoffMs = 30 000 × 2^(attempts−1)", () => {
    const f = fn(m, "writeBackoffMs");
    expect([1, 2, 3, 4].map((n) => f(n))).toEqual([30_000, 60_000, 120_000, 240_000]);
  });
  it("HUB-BR-36 · R11 · khConnectionAudit ⇒ đúng {name, base_url, secret_id, summary_project, version} (không giá trị khoá)", () => {
    const f = fn(m, "khConnectionAudit");
    expect(
      f({
        name: "kh-main",
        baseUrl: "https://kh.example.com",
        secretId: "c1a10000-0000-4000-8000-000000000001",
        summaryProject: "proj-a",
        version: 3,
      }),
    ).toEqual({
      name: "kh-main",
      base_url: "https://kh.example.com",
      secret_id: "c1a10000-0000-4000-8000-000000000001",
      summary_project: "proj-a",
      version: 3,
    });
  });
});
