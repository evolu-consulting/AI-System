// CHAT-AC-01..04 · phiên + token của mock chat (plan C1 §1 Q7, §3.4, spec §9 M3).
// Access = JWT EdDSA (jose), cặp khoá Ed25519 sinh khi tạo; claims như Admin + `jti` = số thứ tự cấp.
// Thu hồi access theo MỐC SỐ THỨ TỰ (không theo `iat` giây): token cấp cùng giây trước/sau mốc vẫn phân biệt được.
import { randomBytes, randomUUID } from "node:crypto";
import { ACCESS_TOKEN_EXPIRES_IN } from "@ai/contracts";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";

const ALG = "EdDSA";
const ISSUER = "admin";
const AUDIENCE = "ai-system";
const KID = "mock";

export type AccessClaims = { sub: string; tid: string; sid: string };
type Session = { userId: string; tenantId: string; current: string; revoked: boolean };
export type RefreshResult =
  | { ok: true; sid: string; userId: string; refreshToken: string }
  | { ok: false; code: "INVALID_REFRESH_TOKEN" | "REFRESH_SUPERSEDED" };

export type SessionStore = {
  open(userId: string, tenantId: string): { sid: string; refreshToken: string };
  rotate(refreshToken: string): RefreshResult;
  /** Huỷ phiên của refresh token (cũ hay mới); token lạ → bỏ qua (logout idempotent). */
  revoke(refreshToken: string): void;
  signAccess(sid: string): Promise<string>;
  verifyAccess(token: string): Promise<AccessClaims | null>;
  /** Mọi access đã cấp tới giờ → không hợp lệ; token cấp sau đó hợp lệ (CHAT-AC-03, K-A9). */
  expireAccess(): void;
  reset(): void;
};

const opaque = () => randomBytes(32).toString("base64url");

class MockSessionStore implements SessionStore {
  private readonly keys = generateKeyPair(ALG, { crv: "Ed25519" });
  private readonly sessions = new Map<string, Session>();
  /** refresh token → sid; giữ cả token đã xoay để trả REFRESH_SUPERSEDED. */
  private readonly refresh = new Map<string, string>();
  private seq = 0;
  private cutoff = 0;

  private issueRefresh(sid: string, s: Session): string {
    const token = opaque();
    s.current = token;
    this.refresh.set(token, sid);
    return token;
  }

  private sessionOf(refreshToken: string): { sid: string; s: Session } | null {
    const sid = this.refresh.get(refreshToken);
    const s = sid ? this.sessions.get(sid) : undefined;
    return sid && s ? { sid, s } : null;
  }

  open(userId: string, tenantId: string) {
    const sid = randomUUID();
    const s: Session = { userId, tenantId, current: "", revoked: false };
    this.sessions.set(sid, s);
    return { sid, refreshToken: this.issueRefresh(sid, s) };
  }

  rotate(token: string): RefreshResult {
    const found = this.sessionOf(token);
    if (!found || found.s.revoked) return { ok: false, code: "INVALID_REFRESH_TOKEN" };
    if (found.s.current !== token) return { ok: false, code: "REFRESH_SUPERSEDED" };
    const refreshToken = this.issueRefresh(found.sid, found.s);
    return { ok: true, sid: found.sid, userId: found.s.userId, refreshToken };
  }

  revoke(token: string): void {
    const found = this.sessionOf(token);
    if (found) found.s.revoked = true;
  }

  async signAccess(sid: string): Promise<string> {
    const s = this.sessions.get(sid);
    if (!s) throw new Error("phiên mock không tồn tại");
    this.seq += 1;
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ tid: s.tenantId, role: "member", sid })
      .setProtectedHeader({ alg: ALG, kid: KID })
      .setSubject(s.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti(String(this.seq))
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TOKEN_EXPIRES_IN)
      .sign((await this.keys).privateKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload: p } = await jwtVerify(token, (await this.keys).publicKey, {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: AUDIENCE,
        requiredClaims: ["sub", "jti", "iat", "exp"],
      });
      const sid = typeof p.sid === "string" ? p.sid : "";
      const s = this.sessions.get(sid);
      if (!s || s.revoked || Number(p.jti) <= this.cutoff) return null;
      return { sub: s.userId, tid: s.tenantId, sid };
    } catch {
      return null;
    }
  }

  expireAccess(): void {
    this.cutoff = this.seq;
  }

  reset(): void {
    this.sessions.clear();
    this.refresh.clear();
    this.cutoff = this.seq;
  }
}

export function createSessionStore(): SessionStore {
  return new MockSessionStore();
}
