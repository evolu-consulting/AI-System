// HUB-FR-131 · plan K1 §3.1, §11 G5–G7 — ca biên ngoài test khoá (tests/acceptance/K1/rules/kh-check-rules.test.ts).
import { describe, expect, test } from "bun:test";
import { evaluateKhCheck, type KhProbe, khCheckShouldContinue } from "./kh.check.rules";

const AT = "2026-10-13T08:00:00.000Z";
const GOOD: KhProbe = {
  url: { ok: true, baseUrl: "https://kh.example.com", localDev: false },
  health: { status: 200, body: { model: "BAAI/bge-m3" } },
  versionNoKey: { status: 401, body: {} },
  key: "ok",
  versionWithKey: { status: 200, body: { version: "v6.4" } },
  projects: { status: 200, body: { projects: { a: {} } } },
  summaryProject: null,
};

describe("evaluateKhCheck biên", () => {
  test("HUB-FR-131 · G5 · version không phải chuỗi ⇒ kh_version null, found = String(raw); bước 6 vẫn chạy", () => {
    const r = evaluateKhCheck(
      { ...GOOD, versionWithKey: { status: 200, body: { version: 6.3 } } },
      AT,
    );
    expect(r.kh_version).toBeNull();
    expect(r.items).toEqual([
      { code: "kh_version_too_old", level: "error", params: { found: "6.3" } },
    ]);
    expect(r.projects).toEqual(["a"]);
  });
  test("HUB-FR-131 · G7 · dừng ở bước 5 (timeout) ⇒ kh_version null, projects [], embedder theo bước 2", () => {
    const r = evaluateKhCheck({ ...GOOD, versionWithKey: "timeout", projects: null }, AT);
    expect(r).toEqual({
      status: "error",
      checked_at: AT,
      kh_version: null,
      embedder: "BAAI/bge-m3",
      projects: [],
      items: [{ code: "kh_timeout", level: "error" }],
    });
  });
  test("HUB-FR-131 · /version có khoá 500 ⇒ kh_unreachable {status}; /projects network ⇒ kh_unreachable không status", () => {
    const a = evaluateKhCheck({ ...GOOD, versionWithKey: { status: 500, body: {} } }, AT);
    expect(a.items).toEqual([{ code: "kh_unreachable", level: "error", params: { status: 500 } }]);
    const b = evaluateKhCheck({ ...GOOD, projects: "network" }, AT);
    expect([b.status, b.kh_version, b.items]).toEqual([
      "error",
      "v6.4",
      [{ code: "kh_unreachable", level: "error" }],
    ]);
  });
});

describe("khCheckShouldContinue biên", () => {
  test("HUB-BR-40 · G6 · kh_auth_disabled ⇒ dừng (không gửi khoá); dev ⇒ đi tiếp; đủ 6 bước ⇒ false", () => {
    const off = { status: 200, body: {} };
    expect(khCheckShouldContinue({ url: GOOD.url, health: GOOD.health, versionNoKey: off })).toBe(
      false,
    );
    const dev = { ok: true as const, baseUrl: "http://localhost:4030", localDev: true };
    expect(khCheckShouldContinue({ url: dev, health: GOOD.health, versionNoKey: off })).toBe(true);
    expect(khCheckShouldContinue(GOOD)).toBe(false);
    expect(khCheckShouldContinue({})).toBe(true);
  });
});
