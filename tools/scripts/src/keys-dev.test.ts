import { describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import {
  fillMissingKey,
  generateDevSecrets,
  isProduction,
  mergeEnv,
  quotePem,
  readEnvValue,
  TEST_ENV_RE,
} from "./keys-dev";

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

describe("HUB-FR-68 · keys:dev HUB_SECRETS_KEY (H4b-1 plan §4)", () => {
  const K = "HUB_SECRETS_KEY";
  test("sinh base64 32 byte, khác SECRET_MASTER_KEY", () => {
    const s = generateDevSecrets();
    expect(Buffer.from(s.HUB_SECRETS_KEY, "base64").length).toBe(32);
    expect(s.HUB_SECRETS_KEY).not.toBe(s.SECRET_MASTER_KEY);
  });
  test("fillMissingKey: vắng ⇒ thêm cuối; rỗng ⇒ điền; đã có ⇒ null (không ghi đè)", () => {
    expect(fillMissingKey("A=1\n", K, "k1")).toBe("A=1\nHUB_SECRETS_KEY=k1\n");
    expect(fillMissingKey("HUB_SECRETS_KEY=\n", K, "k1")).toBe("HUB_SECRETS_KEY=k1\n");
    expect(fillMissingKey("HUB_SECRETS_KEY=old\n", K, "k1")).toBeNull();
  });
  test("HUB-FR-04 · fillMissingKey: giá trị trùng SECRET_MASTER_KEY của file ⇒ null", () => {
    expect(fillMissingKey("SECRET_MASTER_KEY=k1\n", K, "k1")).toBeNull();
  });
  test("TEST_ENV_RE chỉ khớp .env.test-<tag>.local", () => {
    const names = [".env.test-h4b1_qc.local", ".env.local", ".env.test-.local", ".env.example"];
    expect(names.map((n) => TEST_ENV_RE.test(n))).toEqual([true, false, false, false]);
  });
});
