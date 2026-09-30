import { describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { generateDevSecrets, isProduction, mergeEnv, quotePem, readEnvValue } from "./keys-dev";

describe("ADM-NFR-06 · keys:dev mergeEnv", () => {
  const base = "# c\nA=\nB=giu\n\nC=\n";

  test("chỉ điền key rỗng, giữ comment/thứ tự/dòng trống", () => {
    expect(mergeEnv(base, { A: "1", B: "2" }, false)).toBe("# c\nA=1\nB=giu\n\nC=\n");
  });

  test("force ghi đè giá trị có sẵn", () => {
    expect(mergeEnv(base, { B: "2" }, true)).toBe("# c\nA=\nB=2\n\nC=\n");
  });

  test("key vắng → thêm cuối file; file không có \\n cuối vẫn đúng", () => {
    expect(mergeEnv("A=1", { Z: "9" }, false)).toBe("A=1\nZ=9\n");
    expect(mergeEnv("", { Z: "9" }, false)).toBe("Z=9\n");
  });

  test("giữ CRLF", () => {
    expect(mergeEnv("A=\r\nB=x\r\n", { A: "1", C: "3" }, false)).toBe("A=1\r\nB=x\r\nC=3\r\n");
  });

  test('giá trị "" (nháy rỗng) coi là rỗng', () => {
    expect(mergeEnv('A=""\n', { A: "1" }, false)).toBe("A=1\n");
  });

  test("readEnvValue bỏ nháy, bỏ qua comment", () => {
    expect(readEnvValue('# APP_ENV=production\nAPP_ENV="test"\n', "APP_ENV")).toBe("test");
    expect(readEnvValue("X=1\n", "APP_ENV")).toBeUndefined();
  });
});

describe("ADM-NFR-06 · keys:dev isProduction", () => {
  test.each([
    [{ APP_ENV: "production" }, undefined, true],
    [{}, "APP_ENV=production\n", true],
    [{ APP_ENV: "development" }, "APP_ENV=production\n", true],
    [{ APP_ENV: "development" }, "APP_ENV=development\n", false],
    [{}, undefined, false],
  ])("procEnv %j + .env.local %j → %p", (procEnv, text, want) => {
    expect(isProduction(procEnv, text)).toBe(want);
  });
});

describe("ADM-NFR-06 · keys:dev generateDevSecrets", () => {
  const s = generateDevSecrets(new Date(2026, 9, 1));

  test("cặp Ed25519 PEM PKCS8/SPKI ký và verify được", () => {
    expect(s.JWT_PRIVATE_KEY).toStartWith("-----BEGIN PRIVATE KEY-----");
    expect(s.JWT_PUBLIC_KEY).toStartWith("-----BEGIN PUBLIC KEY-----");
    const msg = Buffer.from("m0");
    const sig = sign(null, msg, createPrivateKey(s.JWT_PRIVATE_KEY));
    expect(verify(null, msg, createPublicKey(s.JWT_PUBLIC_KEY), sig)).toBe(true);
  });

  test("kid, master key 32 byte, mật khẩu 20 ký tự chữ số", () => {
    expect(s.JWT_KID).toBe("dev-20261001");
    expect(Buffer.from(s.SECRET_MASTER_KEY, "base64")).toHaveLength(32);
    expect(s.SEED_ADMIN_PASSWORD).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  test("quotePem ra một dòng, mở lại bằng dotenv của Bun giống PEM gốc", () => {
    const q = quotePem(s.JWT_PRIVATE_KEY);
    expect(q).not.toContain("\n");
    expect(q.slice(1, -1).replace(/\\n/g, "\n")).toBe(s.JWT_PRIVATE_KEY.trimEnd());
  });
});
