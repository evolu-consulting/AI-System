// ADM-FR-01, ADM-FR-02, ADM-FR-06, ADM-FR-07, ADM-NFR-01 · luật auth dạng hàm thuần (plan M1 §4).
// Không import I/O: thời gian và nguồn ngẫu nhiên truyền vào.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN, TEMP_PASSWORD_LEN } from "@ai/contracts";

export const MAX_LOGIN_ATTEMPTS = 5;
export const TEMP_LOCK_MS = 15 * 60_000;
export const ACCESS_TOKEN_TTL_S = 900;
export const REFRESH_TOKEN_TTL_S = 2_592_000;
export const CHANGE_TOKEN_TTL_S = 300;
export const REFRESH_GRACE_MS = 10_000;

export type RevokeReason =
  | "rotated"
  | "reuse"
  | "logout"
  | "logout_all"
  | "user_locked"
  | "tenant_locked"
  | "password_changed"
  | "password_reset";

export type LockState = { failedLogins: number; lockedUntil: Date | null };

export function normalizeLoginId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isTempLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/** Trạng thái bộ đếm trước khi verify: khoá đã hết hạn → về 0. */
export function clearExpiredLock(s: LockState, now: Date): LockState {
  if (s.lockedUntil !== null && s.lockedUntil.getTime() <= now.getTime()) {
    return { failedLogins: 0, lockedUntil: null };
  }
  return { failedLogins: s.failedLogins, lockedUntil: s.lockedUntil };
}

/** Sau một lần sai: +1; chạm MAX → { 0, now+15' } (lần 5 vẫn 401, lần 6 mới 423 — AC-A01). */
export function afterFailedLogin(failedLogins: number, now: Date): LockState {
  const next = failedLogins + 1;
  if (next >= MAX_LOGIN_ATTEMPTS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + TEMP_LOCK_MS) };
  }
  return { failedLogins: next, lockedUntil: null };
}

export function canSignIn(
  u: { active: boolean; lockedByTenant: boolean },
  tenantActive: boolean,
): boolean {
  return u.active && !u.lockedByTenant && tenantActive;
}

export type LoginStep = "temp_locked" | "verify";
export type PostVerifyOutcome = "account_locked" | "password_change_required" | "authenticated";

export function outcomeAfterPasswordOk(
  u: { active: boolean; lockedByTenant: boolean; mustChangePassword: boolean },
  tenantActive: boolean,
): PostVerifyOutcome {
  if (!canSignIn(u, tenantActive)) return "account_locked";
  return u.mustChangePassword ? "password_change_required" : "authenticated";
}

export type RefreshVerdict = "valid" | "expired" | "superseded" | "reuse";

/** Đã thu hồi thắng hết hạn (plan §10 G4). `rotated` trong ≤ 10 s → superseded (tab song song). */
export function classifyRefresh(
  t: { revokedAt: Date | null; revokedReason: RevokeReason | null; expiresAt: Date },
  now: Date,
): RefreshVerdict {
  if (t.revokedAt !== null) {
    const age = now.getTime() - t.revokedAt.getTime();
    return t.revokedReason === "rotated" && age <= REFRESH_GRACE_MS ? "superseded" : "reuse";
  }
  return t.expiresAt.getTime() <= now.getTime() ? "expired" : "valid";
}

export function isAcceptableNewPassword(pw: string): boolean {
  return pw.length >= PASSWORD_MIN_LEN && pw.length <= PASSWORD_MAX_LEN;
}

export const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// 248 = 4·62: byte ≥ 248 bị bỏ để mọi ký tự có cùng xác suất.
const REJECT_FROM = 4 * TEMP_PASSWORD_ALPHABET.length;

/** 16 ký tự, lấy mẫu loại bỏ byte ≥ 248 để không lệch. */
export function generateTempPassword(randomBytes: (n: number) => Uint8Array): string {
  let out = "";
  while (out.length < TEMP_PASSWORD_LEN) {
    for (const b of randomBytes(TEMP_PASSWORD_LEN * 2)) {
      if (b >= REJECT_FROM) continue;
      out += TEMP_PASSWORD_ALPHABET[b % TEMP_PASSWORD_ALPHABET.length];
      if (out.length === TEMP_PASSWORD_LEN) break;
    }
  }
  return out;
}

export function changeTokenMatches(pwcClaim: number, passwordChangedAt: Date): boolean {
  return pwcClaim === passwordChangedAt.getTime();
}
