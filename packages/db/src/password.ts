// ADM-NFR-01 · băm mật khẩu argon2id (spec M1 §6: m=19456 KiB, t=2, p=1 — mức OWASP). Dùng chung seed + admin-api.
// Verify đọc tham số từ chuỗi PHC nên đổi tham số sau này không cần migrate.

export const PASSWORD_HASH_OPTIONS = {
  algorithm: "argon2id",
  memoryCost: 19456,
  timeCost: 2,
} as const;

export function hashPassword(pw: string): Promise<string> {
  return Bun.password.hash(pw, PASSWORD_HASH_OPTIONS);
}

/** Hash hỏng/không phải PHC → false (không ném), để luồng đăng nhập luôn trả 401 đồng nhất. */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(pw, hash);
  } catch {
    return false;
  }
}
