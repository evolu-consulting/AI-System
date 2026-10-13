// HUB-FR-131 · HUB-BR-37 · plan K1 §2.1 — ca biên ngoài test khoá (tests/acceptance/K1/rules/kh-rules.test.ts).
import { describe, expect, test } from "bun:test";
import {
  classifyKhFailure,
  decodeKhCursor,
  encodeKhCursor,
  khResetsCheck,
  khSecretReject,
  khUrlPolicy,
  khUsableOrigins,
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

describe("HUB-FR-131 · luật Studio kết nối (T5c)", () => {
  const id = "c1a10000-0000-4000-8000-000000000041";
  test("cursor (lower(name), id) khứ hồi; rác ⇒ undefined", () => {
    expect(decodeKhCursor(encodeKhCursor(["kh-main", id]))).toEqual(["kh-main", id]);
    expect(decodeKhCursor(undefined)).toBeUndefined();
    expect(decodeKhCursor("!!")).toBeUndefined();
    expect(decodeKhCursor(Buffer.from('["a","x"]').toString("base64url"))).toBeUndefined();
    expect(decodeKhCursor(Buffer.from("{").toString("base64url"))).toBeUndefined();
  });
  test("HUB-BR-36 · khSecretReject: not_found / wrong_kind / not_platform / hợp lệ", () => {
    expect(khSecretReject(undefined)).toBe("not_found");
    expect(khSecretReject({ kind: "provider_api_key", tenantId: null })).toBe("wrong_kind");
    expect(khSecretReject({ kind: "kh_api_key", tenantId: id })).toBe("not_platform");
    expect(khSecretReject({ kind: "kh_api_key", tenantId: null })).toBeNull();
  });
  test("Q34 · khResetsCheck: đổi URL hoặc khoá ⇒ true; chỉ khác hoa thường của uuid ⇒ false", () => {
    const a = { baseUrl: "https://kh.example.com", secretId: id };
    expect(khResetsCheck(a, { ...a })).toBe(false);
    expect(khResetsCheck(a, { ...a, secretId: id.toUpperCase() })).toBe(false);
    expect(khResetsCheck(a, { ...a, baseUrl: "https://kh.example.com/v" })).toBe(true);
    expect(khResetsCheck(a, { ...a, secretId: id.replace("41", "42") })).toBe(true);
  });
});

describe("HUB-FR-131 · khUsableOrigins (GET C allowed_origins)", () => {
  test("bỏ http không loopback, rác; dev giữ http loopback; production bỏ mọi http; chuẩn hoá + bỏ trùng", () => {
    const cfg = [
      "https://KH.example.com/",
      "http://kh.example.com",
      "http://localhost:4030",
      "x",
      "https://kh.example.com",
    ];
    expect(khUsableOrigins(cfg, { dev: true })).toEqual([
      "https://kh.example.com",
      "http://localhost:4030",
    ]);
    expect(khUsableOrigins(cfg, { dev: false })).toEqual(["https://kh.example.com"]);
  });
});
