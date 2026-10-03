// ADM-FR-08 · ADM-BR-09 · M4-R16 · luật thuần 2FA (plan-cd §6, §7). Không import I/O.
import type { ErrorCode, Role } from "@ai/contracts";

export type RuleError = { code: ErrorCode; details?: unknown };
export type Actor = { userId: string; tenantId: string; role: Role };

export const BACKUP_CODE_COUNT = 10;
/** 31 ký tự, bỏ 0/1/i/l/o (dễ nhầm). */
export const BACKUP_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const TOTP_TOKEN_TTL_S = 300;
export const TOTP_SETUP_TTL_S = 600;

const CODE_LEN = 8;
// 248 = 8·31: byte ≥ 248 bị bỏ để mọi ký tự có cùng xác suất (như generateTempPassword).
const REJECT_FROM = 8 * BACKUP_ALPHABET.length;
// Mỗi mã một lần xin 18 byte, phần dư bỏ (byte độc lập nên không lệch). 18 (không phải 16): nguồn có chu kỳ không
// làm các mã trùng pha nhau (test-plan-cd D-R12b), spec-decisions T9a.
const BYTES_PER_DRAW = CODE_LEN * 2 + 2;
const MAX_DRAWS = 1000;

/** Một mã 8 ký tự; mỗi lần xin `BYTES_PER_DRAW` byte (dư bỏ), thiếu ký tự thì xin tiếp. */
function drawCode(randomBytes: (n: number) => Uint8Array, budget: { left: number }): string {
  let out = "";
  while (out.length < CODE_LEN) {
    if (budget.left-- <= 0) throw new Error("totp.rules: nguồn ngẫu nhiên không đủ");
    for (const b of randomBytes(BYTES_PER_DRAW)) {
      if (b >= REJECT_FROM) continue;
      out += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
      if (out.length === CODE_LEN) break;
    }
  }
  return out;
}

/** 10 mã "xxxx-xxxx" đôi một khác nhau, lấy mẫu loại bỏ byte ≥ 248. */
export function generateBackupCodes(randomBytes: (n: number) => Uint8Array): string[] {
  const seen = new Set<string>();
  const budget = { left: MAX_DRAWS };
  while (seen.size < BACKUP_CODE_COUNT) seen.add(drawCode(randomBytes, budget));
  return [...seen].map((c) => `${c.slice(0, 4)}-${c.slice(4)}`);
}

/** trim, chữ thường, bỏ "-"/khoảng trắng; ≠ 8 ký tự thuộc BACKUP_ALPHABET → null. */
export function normalizeBackupCode(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[-\s]/g, "");
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!BACKUP_ALPHABET.includes(ch)) return null;
  return s;
}

export function canUseTotp(role: Role): boolean {
  return role === "platform_admin" || role === "tenant_admin";
}

export type TotpState = { enabledAt: Date | null; pendingExpiresAt: Date | null } | null;

/** Pending và chưa hết hạn (biên `pendingExpiresAt = now` → hết hạn). */
export function setupUsable(s: TotpState, now: Date): boolean {
  if (!s || s.enabledAt !== null || s.pendingExpiresAt === null) return false;
  return s.pendingExpiresAt.getTime() > now.getTime();
}

/** Thứ tự sau mật khẩu đúng (Q10): account_locked → totp_required (đã bật) → password_change_required → authenticated. */
export function loginNextStep(u: {
  canSignIn: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}): "account_locked" | "totp_required" | "password_change_required" | "authenticated" {
  if (!u.canSignIn) return "account_locked";
  if (u.totpEnabled) return "totp_required";
  if (u.mustChangePassword) return "password_change_required";
  return "authenticated";
}

/** Tự mình → SELF_ACTION_FORBIDDEN; tenant_admin với user tenant khác → NOT_FOUND (không lộ tồn tại). */
export function canResetTotpFor(
  actor: Actor,
  target: { id: string; tenantId: string },
): RuleError | null {
  if (actor.role !== "platform_admin" && actor.tenantId !== target.tenantId)
    return { code: "NOT_FOUND" };
  if (actor.userId === target.id) return { code: "SELF_ACTION_FORBIDDEN" };
  return null;
}
