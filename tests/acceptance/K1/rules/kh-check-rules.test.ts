// HUB-FR-131 · HUB-BR-40 · K1-AC01 · CR-073 · plan K1 §2.2 + §3.1 (6 bước, 7 lỗi + 5 cảnh báo) · spec §3.0, §9 Q27/Q28/Q31/Q33 ·
// test-plan K1 §4 R30–R41: `evaluateKhCheck` (KhProbe ⇒ KhCheckResult) và `khCheckShouldContinue` (dừng sau mục "dừng").
// Module vắng ⇒ đỏ ở `fn()`. Thứ tự mục không ép buộc (so tập mã).
import { describe, expect, it } from "bun:test";
import { fn, loadCheck } from "./_rules";

const m = await loadCheck();
const AT = "2026-10-13T08:00:00.000Z";
// biome-ignore lint/suspicious/noExplicitAny: probe/kết quả JSON
type J = any;
const GOOD: J = {
  url: { ok: true, baseUrl: "https://kh.example.com", localDev: false },
  health: { status: 200, body: { status: "ok", model: "BAAI/bge-m3" } },
  versionNoKey: { status: 401, body: { detail: "missing or invalid API key" } },
  key: "ok",
  versionWithKey: { status: 200, body: { version: "v6.4", source: "env", model: "BAAI/bge-m3" } },
  projects: { status: 200, body: { version: 1, projects: { "proj-b": {}, "proj-a": {} } } },
  summaryProject: "proj-a",
};
const probe = (o: J = {}): J => ({ ...GOOD, ...o });
const ev = (o: J = {}): J => fn(m, "evaluateKhCheck")(probe(o), AT);
const codes = (r: J): string[] =>
  ((r?.items ?? []) as J[]).map((i) => `${i.level}:${i.code}`).sort();
const item = (r: J, code: string): J => ((r?.items ?? []) as J[]).find((i) => i.code === code);

describe("R30–R33 · đạt, URL, /health [plan §3.1 bước 1–2]", () => {
  it("HUB-FR-131 · K1-AC01 · R30 · đủ 6 bước đạt ⇒ status ok, kh_version, embedder, projects (summary_project trước, rồi tên tăng), items []", () => {
    expect(ev()).toEqual({
      status: "ok",
      checked_at: AT,
      kh_version: "v6.4",
      embedder: "BAAI/bge-m3",
      projects: ["proj-a", "proj-b"],
      items: [],
    });
    expect(ev({ summaryProject: "proj-b" }).projects).toEqual(["proj-b", "proj-a"]);
  });
  it("HUB-BR-37 · R31 · URL bị chặn ⇒ lỗi kh_url_not_allowed {reason}, status error, chưa có version/project", () => {
    const r = ev({
      url: { ok: false, reason: "not_in_allowlist" },
      health: null,
      versionNoKey: null,
      key: null,
      versionWithKey: null,
      projects: null,
    });
    expect(r).toMatchObject({ status: "error", kh_version: null, projects: [] });
    expect(r.items).toEqual([
      { code: "kh_url_not_allowed", level: "error", params: { reason: "not_in_allowlist" } },
    ]);
  });
  it("HUB-FR-131 · R32 · /health ≠ 200 ⇒ kh_unreachable {status}; network ⇒ kh_unreachable; timeout ⇒ kh_timeout", () => {
    const rest = { versionNoKey: null, key: null, versionWithKey: null, projects: null };
    const r1 = ev({ health: { status: 503, body: {} }, ...rest });
    expect([r1.status, codes(r1)]).toEqual(["error", ["error:kh_unreachable"]]);
    expect(item(r1, "kh_unreachable").params).toEqual({ status: 503 });
    const r2 = ev({ health: "network", ...rest });
    expect([r2.status, codes(r2)]).toEqual(["error", ["error:kh_unreachable"]]);
    const r3 = ev({ health: "timeout", ...rest });
    expect([r3.status, codes(r3)]).toEqual(["error", ["error:kh_timeout"]]);
  });
  it("HUB-FR-131 · Q33 · R33 · embedder chỉ tiếng Anh ⇒ cảnh báo kh_embedder_english {model}, vẫn ok", () => {
    const model = "BAAI/bge-small-en-v1.5";
    const r = ev({ health: { status: 200, body: { status: "ok", model } } });
    expect([r.status, r.embedder, codes(r)]).toEqual([
      "ok",
      model,
      ["warning:kh_embedder_english"],
    ]);
    expect(item(r, "kh_embedder_english").params).toEqual({ model });
  });
});

describe("R34–R37 · xác thực + khoá + phiên bản [plan §3.1 bước 3–5 · Q27 · Q28]", () => {
  it("HUB-BR-40 · Q28 · R34 · /version không khoá trả 2xx ⇒ lỗi kh_auth_disabled; loopback dev ⇒ chỉ cảnh báo kh_auth_disabled_dev", () => {
    const off = { status: 200, body: { version: "v6.4" } };
    const r = ev({ versionNoKey: off });
    expect(r.status).toBe("error");
    expect(codes(r)).toContain("error:kh_auth_disabled");
    const d = ev({
      url: { ok: true, baseUrl: "http://localhost:4030", localDev: true },
      versionNoKey: off,
    });
    expect([d.status, codes(d)]).toEqual(["ok", ["warning:kh_auth_disabled_dev"]]);
  });
  it("HUB-FR-131 · R35 · /version không khoá trả mã khác 401/2xx (500) ⇒ kh_unreachable {status: 500}", () => {
    const r = ev({
      versionNoKey: { status: 500, body: {} },
      key: null,
      versionWithKey: null,
      projects: null,
    });
    expect([r.status, codes(r)]).toEqual(["error", ["error:kh_unreachable"]]);
    expect(item(r, "kh_unreachable").params).toEqual({ status: 500 });
  });
  it("HUB-BR-36 · R36 · secret không đọc được ⇒ kh_key_invalid; KH từ chối khoá 401/403 (gồm SSO, Q27) ⇒ kh_key_rejected", () => {
    const r = ev({ key: "unreadable", versionWithKey: null, projects: null });
    expect([r.status, codes(r)]).toEqual(["error", ["error:kh_key_invalid"]]);
    for (const status of [401, 403]) {
      const x = ev({ versionWithKey: { status, body: { detail: "x" } }, projects: null });
      expect({ status, r: [x.status, codes(x)] }).toEqual({
        status,
        r: ["error", ["error:kh_key_rejected"]],
      });
    }
  });
  it("HUB-FR-131 · R37 · version < v6.4 ⇒ kh_version_too_old {found}", () => {
    const r = ev({ versionWithKey: { status: 200, body: { version: "v6.3" } } });
    expect(r.status).toBe("error");
    expect(codes(r)).toContain("error:kh_version_too_old");
    expect(String(item(r, "kh_version_too_old")?.params?.found)).toContain("6.3");
  });
});

describe("R38–R41 · /projects + dừng sớm [plan §3.1 bước 6 · Q31]", () => {
  it("HUB-FR-132 · R38 · /projects non-2xx hoặc body sai ⇒ kh_unreachable; rỗng ⇒ cảnh báo kh_projects_empty (+ summary_project_missing)", () => {
    const a = ev({ projects: { status: 500, body: {} } });
    expect([a.status, codes(a)]).toEqual(["error", ["error:kh_unreachable"]]);
    const b = ev({ projects: { status: 200, body: { projects: "x" } } });
    expect([b.status, codes(b)]).toEqual(["error", ["error:kh_unreachable"]]);
    const e = ev({ projects: { status: 200, body: { projects: {} } }, summaryProject: null });
    expect([e.status, e.projects, codes(e)]).toEqual(["ok", [], ["warning:kh_projects_empty"]]);
  });
  it("HUB-FR-132 · Q31 · R39 · > 50 project ⇒ cảnh báo kh_projects_many {count}; projects = summary_project + 49 đầu theo tên", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `p${String(i).padStart(2, "0")}`);
    const obj = Object.fromEntries([...ids, "zz-sum"].reverse().map((id) => [id, {}]));
    const r = ev({ projects: { status: 200, body: { projects: obj } }, summaryProject: "zz-sum" });
    expect([r.status, codes(r)]).toEqual(["ok", ["warning:kh_projects_many"]]);
    expect(item(r, "kh_projects_many").params).toEqual({ count: 61 });
    expect(r.projects).toEqual(["zz-sum", ...ids.slice(0, 49)]);
  });
  it("HUB-FR-133 · R40 · summary_project không trong project khoá thấy ⇒ cảnh báo kh_summary_project_missing {project_id}; ok", () => {
    const r = ev({ summaryProject: "proj-x" });
    expect([r.status, codes(r)]).toEqual(["ok", ["warning:kh_summary_project_missing"]]);
    expect(item(r, "kh_summary_project_missing").params).toEqual({ project_id: "proj-x" });
    expect(r.projects).not.toContain("proj-x");
  });
  it("HUB-FR-131 · R41 · khCheckShouldContinue: URL lỗi / health lỗi / khoá không đọc được / khoá bị từ chối ⇒ false; đang đạt ⇒ true", () => {
    const f = fn(m, "khCheckShouldContinue");
    expect(f({ url: GOOD.url })).toBe(true);
    expect(f({ url: GOOD.url, health: GOOD.health, versionNoKey: GOOD.versionNoKey })).toBe(true);
    expect(f({ url: { ok: false, reason: "invalid" } })).toBe(false);
    expect(f({ url: GOOD.url, health: "timeout" })).toBe(false);
    expect(f({ url: GOOD.url, health: { status: 502, body: {} } })).toBe(false);
    expect(f({ url: GOOD.url, health: GOOD.health, versionNoKey: { status: 500, body: {} } })).toBe(
      false,
    );
    expect(
      f({ url: GOOD.url, health: GOOD.health, versionNoKey: GOOD.versionNoKey, key: "unreadable" }),
    ).toBe(false);
    expect(
      f({
        url: GOOD.url,
        health: GOOD.health,
        versionNoKey: GOOD.versionNoKey,
        key: "ok",
        versionWithKey: { status: 401, body: {} },
      }),
    ).toBe(false);
  });
});
