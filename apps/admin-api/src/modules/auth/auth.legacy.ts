// N5B-FR-02, N5B-FR-04, N5B-NFR-01 · verify mật khẩu đăng nhập: argon2id (M1) + scrypt legacy mgmt-app (N5b).
// Thời gian ngang nhau: trước sunset MỌI đường (user lạ / argon2 / legacy) chạy song song đúng một phép argon2id
// (verify, hoặc hash ở nhánh legacy) + một scrypt (thật hoặc giả); sau sunset chỉ một argon2 verify. Không bao giờ log hash hay mật khẩu.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "@ai/db";
import {
  isLegacyHash,
  LEGACY_PREFIX,
  type LegacyParams,
  parseLegacyHash,
} from "./auth.legacy.rules";

const DK_LEN = 64;

/** scrypt async (threadpool) + so hằng thời gian. Lỗi (maxmem…) ⇒ false, không ném. */
export function scryptVerify(pw: string, p: LegacyParams): Promise<boolean> {
  const want = Buffer.from(p.dkHex, "hex");
  const salt = Buffer.from(p.saltHex, "hex");
  return new Promise((resolve) => {
    // Mật khẩu UTF-8 như `str.encode()` của Python (mgmt-app auth.py).
    scrypt(
      Buffer.from(pw, "utf8"),
      salt,
      DK_LEN,
      { N: p.N, r: p.r, p: p.p, maxmem: p.maxmem },
      (err, got) => {
        resolve(!err && got.length === want.length && timingSafeEqual(got, want));
      },
    );
  });
}

/** Tham số giả = tham số thật của mgmt-app (ln=14, r=8, p=1) để scrypt giả tốn đúng như scrypt thật. */
const DUMMY = parseLegacyHash(
  `${LEGACY_PREFIX}ln=14,r=8,p=1$${randomBytes(16).toString("hex")}$${randomBytes(DK_LEN).toString("hex")}`,
) as LegacyParams;

export type VerifyPrims = {
  argon2: (pw: string, hash: string) => Promise<boolean>;
  scrypt: (pw: string, p: LegacyParams) => Promise<boolean>;
  hash: (pw: string) => Promise<string>;
};
const REAL: VerifyPrims = {
  argon2: (pw, h) => verifyPassword(pw, h),
  hash: (pw) => hashPassword(pw),
  scrypt: (pw, p) => scryptVerify(pw, p),
};

export type VerifyLoginOpts = { dummyHash: string; legacyOn: boolean; prims?: VerifyPrims };
/** `rehash` = hash argon2id mới khi `ok` trên hash legacy (bên gọi ghi trong tx). */
export type VerifyLoginResult = { ok: boolean; rehash: string | null };

/**
 * `stored` null = user không tồn tại. Hash legacy hỏng/vượt trần hoặc sau sunset ⇒ không ok, cùng khối lượng việc.
 * Nhánh legacy thay argon2 *verify* giả bằng argon2 *hash* mật khẩu (cùng tham số ⇒ cùng chi phí): đúng thì có sẵn
 * hash để rehash, không thêm một lần argon2 nối tiếp vào đường nóng (p95, N5B-NFR-01).
 */
export async function verifyLogin(
  pw: string,
  stored: string | null,
  o: VerifyLoginOpts,
): Promise<VerifyLoginResult> {
  const prims = o.prims ?? REAL;
  const legacy = stored !== null && isLegacyHash(stored);
  if (!o.legacyOn) {
    const ok = await prims.argon2(pw, stored !== null && !legacy ? stored : o.dummyHash);
    return { ok: ok && !legacy && stored !== null, rehash: null };
  }
  if (legacy && stored !== null) {
    const parsed = parseLegacyHash(stored);
    const [next, s] = await Promise.all([prims.hash(pw), prims.scrypt(pw, parsed ?? DUMMY)]);
    const ok = parsed !== null && s;
    return { ok, rehash: ok ? next : null };
  }
  const [a] = await Promise.all([prims.argon2(pw, stored ?? o.dummyHash), prims.scrypt(pw, DUMMY)]);
  return { ok: stored !== null && a, rehash: null };
}
