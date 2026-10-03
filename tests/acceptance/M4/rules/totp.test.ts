// ADM-FR-08 · M4-R16 · luật thuần 2FA (test-plan-cd §1.1): `lib/totp.ts` + `modules/auth/totp/totp.rules.ts`
// (chữ ký plan-cd §6). Xanh ở T9a. Vector chuẩn RFC 4226/6238/4648; đối chiếu chéo với oracle `_totp.ts`.
import { describe, expect, it } from "bun:test";
import { loadTotpLib, loadTotpRules } from "../_cd-modules";
import { hotpOracle, RFC_SECRET_ASCII, RFC_SECRET_B32 } from "../_totp";

const SECRET = new TextEncoder().encode(RFC_SECRET_ASCII);
const T_S = 1111111111;
const T = BigInt(Math.floor(T_S / 30));
const at = (s: number) => new Date(s * 1000);
const codeOf = (step: bigint) => hotpOracle(SECRET, step);
const ALPHA = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_RE = new RegExp(`^[${ALPHA}]{4}-[${ALPHA}]{4}$`);

/** Nguồn byte tất định: trả lần lượt từ `next()` theo đúng số byte được xin. */
function source(next: () => number) {
  return (n: number) => Uint8Array.from({ length: n }, next);
}
const cycle = () => {
  let i = 0;
  return () => i++ % 248;
};

describe("ADM-FR-08 · lib/totp (RFC 6238)", () => {
  it("ADM-FR-08 · D-R01 · R16 · hotp đúng vector RFC 4226 phụ lục D (counter 0..9)", async () => {
    const t = await loadTotpLib();
    const want = "755224 287082 359152 969429 338314 254676 287922 162583 399871 520489".split(" ");
    expect(want.map((_, i) => t.hotp(SECRET, BigInt(i)))).toEqual(want);
  });

  it("ADM-FR-08 · D-R02 · R16 · hotp(timeStep(t)) đúng RFC 6238 phụ lục B, giữ số 0 đầu", async () => {
    const t = await loadTotpLib();
    const ts = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
    const got = ts.map((s) => t.hotp(SECRET, t.timeStep(at(s))));
    expect(got).toEqual(["287082", "081804", "050471", "005924", "279037", "353130"]);
  });

  it("ADM-FR-08 · D-R03 · timeStep = floor(unix_s / 30) kiểu bigint", async () => {
    const t = await loadTotpLib();
    const got = [0, 29_999, 30_000, 59_000, 60_000].map((ms) => t.timeStep(new Date(ms)));
    expect(got).toEqual([0n, 0n, 1n, 1n, 2n]);
  });

  it("ADM-FR-08 · D-R04 · base32 RFC 4648 §10 không '=', decode bỏ khoảng trắng/hoa thường, ký tự lạ ném", async () => {
    const t = await loadTotpLib();
    const enc = (s: string) => t.base32Encode(new TextEncoder().encode(s));
    expect(["", "f", "fo", "foo", "foob", "fooba", "foobar"].map(enc)).toEqual([
      "",
      "MY",
      "MZXQ",
      "MZXW6",
      "MZXW6YQ",
      "MZXW6YTB",
      "MZXW6YTBOI",
    ]);
    expect(new TextDecoder().decode(t.base32Decode("mzxw 6ytb oi"))).toBe("foobar");
    expect(() => t.base32Decode("MZXW1")).toThrow();
    expect(() => t.base32Decode("MZ!W")).toThrow();
    const b20 = Uint8Array.from({ length: 20 }, (_, i) => i * 13);
    const s = t.base32Encode(b20);
    expect(s).toHaveLength(32);
    expect(Array.from(t.base32Decode(s))).toEqual(Array.from(b20));
    expect(t.base32Encode(SECRET)).toBe(RFC_SECRET_B32);
  });

  it("ADM-FR-08 · D-R05 · R16 · matchTotp nhận mã bước T, T-1, T+1 → trả đúng bước", async () => {
    const t = await loadTotpLib();
    for (const s of [T, T - 1n, T + 1n])
      expect(t.matchTotp(SECRET, codeOf(s), at(T_S), null)).toBe(s);
  });

  it("ADM-FR-08 · D-R06 · R16 · matchTotp: mã T-2, T+2, mã sai cố định → null", async () => {
    const t = await loadTotpLib();
    const near = new Set([T - 1n, T, T + 1n].map(codeOf));
    const wrong = ["000000", "111111", "999999"].find((c) => !near.has(c)) as string;
    for (const c of [codeOf(T - 2n), codeOf(T + 2n), wrong]) {
      expect(t.matchTotp(SECRET, c, at(T_S), null)).toBeNull();
    }
  });

  it("ADM-FR-08 · D-R07 · R16 chống dùng lại · lastUsedStep = T: mã T → null, T-1 → null, T+1 → T+1", async () => {
    const t = await loadTotpLib();
    expect(t.matchTotp(SECRET, codeOf(T), at(T_S), T)).toBeNull();
    expect(t.matchTotp(SECRET, codeOf(T - 1n), at(T_S), T)).toBeNull();
    expect(t.matchTotp(SECRET, codeOf(T + 1n), at(T_S), T)).toBe(T + 1n);
  });

  it("ADM-FR-08 · D-R08 · matchTotp: mã sai định dạng → null, không ném", async () => {
    const t = await loadTotpLib();
    for (const c of ["28708", "2870822", "abcdef", ""]) {
      expect(t.matchTotp(SECRET, c, at(T_S), null)).toBeNull();
    }
  });

  it("ADM-FR-08 · D-R09 · otpauthUrl: otpauth://totp/<label>?secret&issuer&SHA1/6/30", async () => {
    const t = await loadTotpLib();
    const raw = t.otpauthUrl({
      secretB32: RFC_SECRET_B32,
      issuer: "AI System",
      account: "acme · thu.ha",
    });
    const u = new URL(raw);
    expect(u.protocol).toBe("otpauth:");
    expect(u.host).toBe("totp");
    expect(decodeURIComponent(u.pathname)).toContain("acme · thu.ha");
    expect(u.searchParams.get("secret")).toBe(RFC_SECRET_B32);
    expect(u.searchParams.get("issuer")).toBe("AI System");
    expect(u.searchParams.get("algorithm")).toBe("SHA1");
    expect(u.searchParams.get("digits")).toBe("6");
    expect(u.searchParams.get("period")).toBe("30");
  });

  it("ADM-FR-08 · D-R10 · hằng TOTP + mã dự phòng", async () => {
    const t = await loadTotpLib();
    const r = await loadTotpRules();
    expect([t.TOTP_STEP_S, t.TOTP_DIGITS, t.TOTP_WINDOW, t.TOTP_SECRET_BYTES]).toEqual([
      30, 6, 1, 20,
    ]);
    expect([r.BACKUP_CODE_COUNT, r.TOTP_TOKEN_TTL_S, r.TOTP_SETUP_TTL_S]).toEqual([10, 300, 600]);
    expect(r.BACKUP_ALPHABET).toHaveLength(31);
    for (const ch of ["0", "1", "i", "l", "o"]) expect(r.BACKUP_ALPHABET).not.toContain(ch);
  });
});

describe("ADM-FR-08 · totp.rules", () => {
  it("ADM-FR-08 · D-R11 · R16 · generateBackupCodes: 10 mã xxxx-xxxx theo BACKUP_ALPHABET, đôi một khác nhau", async () => {
    const r = await loadTotpRules();
    const codes: string[] = r.generateBackupCodes(source(cycle()));
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(CODE_RE);
    expect(new Set(codes).size).toBe(10);
  });

  it("ADM-FR-08 · D-R12 · byte ≥ 248 bị bỏ: lần xin đầu toàn byte ≥ 248 không đổi kết quả; byte ≥ 248 không thành ký tự", async () => {
    const r = await loadTotpRules();
    // (a) lần gọi đầu chỉ có byte ≥ 248 → kết quả như nguồn bỏ lần gọi đó.
    const plain = r.generateBackupCodes(source(cycle()));
    let first = true;
    const next = cycle();
    const withBad = (n: number) => {
      if (first) {
        first = false;
        return Uint8Array.from({ length: n }, (_, i) => 248 + (i % 8));
      }
      return Uint8Array.from({ length: n }, next);
    };
    expect(r.generateBackupCodes(withBad)).toEqual(plain);
    // (b) byte tốt chỉ cho chỉ số chữ chẵn; byte xấu 249/251/253/255 (mod 31 = 1/3/5/7, chỉ số lẻ) xen giữa.
    const good = Array.from({ length: 248 }, (_, v) => v).filter((v) => (v % 31) % 2 === 0);
    let k = 0;
    const bad = [249, 251, 253, 255];
    const mixed = () => {
      const i = k++;
      return i % 2 === 0 ? (bad[(i >> 1) % 4] as number) : (good[(i >> 1) % good.length] as number);
    };
    const codes: string[] = r.generateBackupCodes(source(mixed));
    expect(codes).toHaveLength(10);
    for (const ch of codes.join("").replace(/-/g, "")) {
      expect(ALPHA.indexOf(ch) % 2).toBe(0);
    }
  });

  it("ADM-FR-08 · D-R13 · nguồn lặp lại đúng như nhau cho 2 lần xin đầu → vẫn 10 mã khác nhau", async () => {
    const r = await loadTotpRules();
    const next = cycle();
    let calls = 0;
    let firstBuf: Uint8Array | null = null;
    const rep = (n: number) => {
      calls += 1;
      if (calls <= 2 && firstBuf && firstBuf.length === n) return Uint8Array.from(firstBuf);
      const b = Uint8Array.from({ length: n }, next);
      if (calls === 1) firstBuf = b;
      return b;
    };
    const codes: string[] = r.generateBackupCodes(rep);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(CODE_RE);
  });

  it("ADM-FR-08 · D-R14 · normalizeBackupCode: trim, thường, bỏ '-'/khoảng trắng; sai độ dài/ký tự → null", async () => {
    const r = await loadTotpRules();
    const got = [" K7P2-9XQM ", "k7p2 9xqm", "k7p29xq", "k7p2-9xq0", "k7p2-9xqm2"].map(
      r.normalizeBackupCode,
    );
    expect(got).toEqual(["k7p29xqm", "k7p29xqm", null, null, null]);
  });

  it("ADM-FR-08 · D-R15 · canUseTotp: platform_admin, tenant_admin true; member false", async () => {
    const r = await loadTotpRules();
    expect(["platform_admin", "tenant_admin", "member"].map(r.canUseTotp)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("ADM-FR-08 · D-R16 · setupUsable: chỉ pending chưa hết hạn (biên = now → false)", async () => {
    const r = await loadTotpRules();
    const now = new Date("2026-10-01T09:00:00.000Z");
    const pend = (ms: number) => ({
      enabledAt: null,
      pendingExpiresAt: new Date(now.getTime() + ms),
    });
    const states = [null, { enabledAt: now, pendingExpiresAt: null }, pend(1), pend(0), pend(-1)];
    expect(states.map((s) => r.setupUsable(s, now))).toEqual([false, false, true, false, false]);
  });

  it("ADM-FR-08 · D-R17 · Q10 · loginNextStep: account_locked → totp_required → password_change_required → authenticated", async () => {
    const r = await loadTotpRules();
    const s = (canSignIn: boolean, totpEnabled: boolean, mustChangePassword: boolean) =>
      r.loginNextStep({ canSignIn, totpEnabled, mustChangePassword });
    expect([
      s(false, true, true),
      s(true, true, true),
      s(true, false, true),
      s(true, false, false),
      s(true, true, false),
    ]).toEqual([
      "account_locked",
      "totp_required",
      "password_change_required",
      "authenticated",
      "totp_required",
    ]);
  });

  it("ADM-FR-08 · D-R18 · ADM-BR-09 · canResetTotpFor: tenant khác → NOT_FOUND; chính mình → SELF_ACTION_FORBIDDEN", async () => {
    const r = await loadTotpRules();
    const admin = { userId: "u-admin", tenantId: "t-platform", role: "platform_admin" };
    const binh = { userId: "u-binh", tenantId: "t-acme", role: "tenant_admin" };
    expect(r.canResetTotpFor(admin, { id: "u-binh", tenantId: "t-acme" })).toBeNull();
    expect(r.canResetTotpFor(binh, { id: "u-chi", tenantId: "t-acme" })).toBeNull();
    expect(r.canResetTotpFor(binh, { id: "u-hoa", tenantId: "t-globex" })).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(r.canResetTotpFor(binh, { id: "u-binh", tenantId: "t-acme" })).toMatchObject({
      code: "SELF_ACTION_FORBIDDEN",
    });
    expect(r.canResetTotpFor(admin, { id: "u-admin", tenantId: "t-platform" })).toMatchObject({
      code: "SELF_ACTION_FORBIDDEN",
    });
  });
});
