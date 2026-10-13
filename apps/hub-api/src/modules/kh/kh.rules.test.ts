// HUB-FR-131 · HUB-BR-37 · plan K1 §2.1 — ca biên ngoài test khoá (tests/acceptance/K1/rules/kh-rules.test.ts).
import { describe, expect, test } from "bun:test";
import {
  classifyKhFailure,
  khUrlPolicy,
  khVersionOk,
  khWriteRetryable,
  parseKhProjects,
  parseKhVersion,
  writeBackoffMs,
} from "./kh.rules";

describe("khUrlPolicy biên", () => {
  test("HUB-BR-37 · allowlist chuẩn hoá theo origin (hoa thường, '/' cuối, cổng mặc định); mục rác bị bỏ", () => {
    const allowed = ["HTTPS://KH.Example.com:443/", "not a url"];
    expect(khUrlPolicy("https://kh.example.com/api/", allowed, { dev: false })).toEqual({
      ok: true,
      baseUrl: "https://kh.example.com/api",
      localDev: false,
    });
    expect(khUrlPolicy("https://kh.example.com:8443", allowed, { dev: false })).toEqual({
      ok: false,
      reason: "not_in_allowlist",
    });
  });
  test("HUB-BR-37 · scheme khác http(s), '?'/'#' rỗng, khoảng trắng giữa ⇒ invalid; [::1] là loopback dev", () => {
    for (const u of [
      "ftp://kh.example.com",
      "https://kh.example.com/?",
      "https://kh.example.com/#",
      "https://kh .com",
    ])
      expect({ u, r: khUrlPolicy(u, ["https://kh.example.com"], { dev: true }) }).toEqual({
        u,
        r: { ok: false, reason: "invalid" },
      });
    expect(khUrlPolicy("http://[::1]:4030", ["http://[::1]:4030"], { dev: true })).toEqual({
      ok: true,
      baseUrl: "http://[::1]:4030",
      localDev: true,
    });
  });
});

describe("phiên bản, project, lỗi", () => {
  test("HUB-FR-131 · parseKhVersion nhận hậu tố pre-release; khVersionOk so số (6.10 > 6.4)", () => {
    expect(parseKhVersion("v6.4-rc1")).toEqual([6, 4]);
    expect(parseKhVersion(" 6.5 ")).toEqual([6, 5]);
    expect(parseKhVersion("v6")).toBeNull();
    expect(khVersionOk([6, 10])).toBe(true);
  });
  test("HUB-FR-132 · parseKhProjects: mảng ⇒ null; sắp theo mã ký tự", () => {
    expect(parseKhProjects({ projects: ["a"] })).toBeNull();
    expect(parseKhProjects({ projects: { b: 1, B: 1, a: 1 } })).toEqual(["B", "a", "b"]);
  });
  test("HUB-FR-134 · 504 ⇒ server_error, thử lại; 404 không thử lại; attempts ≤ 0 ⇒ 30 s", () => {
    expect(classifyKhFailure(504)).toBe("server_error");
    expect([khWriteRetryable(504), khWriteRetryable(404)]).toEqual([true, false]);
    expect(writeBackoffMs(0)).toBe(30_000);
  });
});
