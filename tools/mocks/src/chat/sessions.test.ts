import { describe, expect, test } from "bun:test";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { createSessionStore } from "./sessions";

const U = "00000000-0000-4000-8000-0000000c1a02";
const T = "00000000-0000-4000-8000-0000000c1a00";

describe("CHAT-AC-03 · SessionStore mock", () => {
  test("access JWT EdDSA, claims như Admin, verify được", async () => {
    const s = createSessionStore();
    const { sid } = s.open(U, T);
    const token = await s.signAccess(sid);
    expect(decodeProtectedHeader(token)).toEqual({ alg: "EdDSA", kid: "mock" });
    const p = decodeJwt(token);
    expect(p).toMatchObject({
      iss: "admin",
      aud: "ai-system",
      sub: U,
      tid: T,
      role: "member",
      sid,
    });
    expect((p.exp ?? 0) - (p.iat ?? 0)).toBe(900);
    expect(await s.verifyAccess(token)).toEqual({ sub: U, tid: T, sid });
    expect(await s.verifyAccess(`${token}x`)).toBeNull();
  });

  test("M3: expireAccess thu hồi theo mốc, token cấp ngay sau (cùng giây) vẫn hợp lệ", async () => {
    const s = createSessionStore();
    const { sid } = s.open(U, T);
    const old = await s.signAccess(sid);
    s.expireAccess();
    const fresh = await s.signAccess(sid);
    expect(fresh).not.toBe(old);
    expect(await s.verifyAccess(old)).toBeNull();
    expect(await s.verifyAccess(fresh)).not.toBeNull();
  });
});

describe("CHAT-AC-03, CHAT-AC-04 · SessionStore mock: refresh, logout, reset", () => {
  test("xoay vòng: token cũ → SUPERSEDED, lạ → INVALID; revoke huỷ cả refresh lẫn access", async () => {
    const s = createSessionStore();
    const { sid, refreshToken } = s.open(U, T);
    const r = s.rotate(refreshToken);
    if (!r.ok) throw new Error("rotate phải ok");
    expect(r.refreshToken).not.toBe(refreshToken);
    expect(s.rotate(refreshToken)).toEqual({ ok: false, code: "REFRESH_SUPERSEDED" });
    expect(s.rotate("la")).toEqual({ ok: false, code: "INVALID_REFRESH_TOKEN" });
    const access = await s.signAccess(sid);
    s.revoke(refreshToken);
    expect(s.rotate(r.refreshToken)).toEqual({ ok: false, code: "INVALID_REFRESH_TOKEN" });
    expect(await s.verifyAccess(access)).toBeNull();
  });

  test("reset xoá mọi phiên", async () => {
    const s = createSessionStore();
    const { sid, refreshToken } = s.open(U, T);
    const access = await s.signAccess(sid);
    s.reset();
    expect(s.rotate(refreshToken).ok).toBe(false);
    expect(await s.verifyAccess(access)).toBeNull();
  });
});
