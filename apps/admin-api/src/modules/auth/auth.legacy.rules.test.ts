// N5B-FR-02, N5B-FR-04 · parse hash legacy (scrypt mgmt-app) + trần tham số + sunset (spec N5b §2).
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LEGACY_SUNSET,
  isLegacyHash,
  LEGACY_MAXMEM,
  legacyActive,
  parseLegacyHash,
} from "./auth.legacy.rules";

const SALT = "00112233445566778899aabbccddeeff";
const DK = "ab".repeat(64);
const h = (params: string, salt = SALT, dk = DK) => `$scrypt-legacy$${params}$${salt}$${dk}`;

describe("N5B-FR-02 · parseLegacyHash", () => {
  test("N5B-FR-02 · tham số mgmt-app (ln=14,r=8,p=1) ⇒ N=16384, maxmem trong trần", () => {
    const p = parseLegacyHash(h("ln=14,r=8,p=1"));
    expect(p).toEqual({
      N: 16384,
      r: 8,
      p: 1,
      saltHex: SALT,
      dkHex: DK,
      maxmem: 128 * 16384 * 8 + 128 * 8 * 1 + 1024 * 1024,
    });
    expect(isLegacyHash(h("ln=14,r=8,p=1"))).toBe(true);
  });

  test("N5B-FR-02 · biên trần: ln=17,r=8,p=2 nhận; maxmem ≤ LEGACY_MAXMEM", () => {
    const p = parseLegacyHash(h("ln=17,r=8,p=2"));
    expect(p?.N).toBe(131072);
    expect(p?.maxmem).toBeLessThanOrEqual(LEGACY_MAXMEM);
  });

  test("N5B-FR-02 · vượt trần ⇒ null (ln 18, r 9, p 3, r/p 0)", () => {
    for (const params of [
      "ln=18,r=8,p=1",
      "ln=14,r=9,p=1",
      "ln=14,r=8,p=3",
      "ln=14,r=0,p=1",
      "ln=14,r=8,p=0",
    ])
      expect(parseLegacyHash(h(params))).toBeNull();
  });
});

describe("N5B-FR-02 · parseLegacyHash — hỏng, trần bộ nhớ", () => {
  test("N5B-FR-02 · hỏng ⇒ null: dk ≠ 64 byte, salt ngắn/lẻ/hoa, thứ tự tham số, tiền tố khác, rác", () => {
    const bad = [
      h("ln=14,r=8,p=1", SALT, "ab".repeat(32)),
      h("ln=14,r=8,p=1", SALT, "ab".repeat(65)),
      h("ln=14,r=8,p=1", "0011223344556677".slice(0, 14)),
      h("ln=14,r=8,p=1", `${SALT}a`),
      h("ln=14,r=8,p=1", SALT.toUpperCase()),
      h("ln=14,r=8,p=1", "zz".repeat(16)),
      h("r=8,ln=14,p=1"),
      h("ln=014,r=8,p=1"),
      `scrypt$${SALT}$${DK}`,
      `scrypt:16384:8:1$${SALT}$${DK}`,
      "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA",
      "",
      `${h("ln=14,r=8,p=1")}\n`,
    ];
    for (const b of bad) expect(parseLegacyHash(b)).toBeNull();
    expect(isLegacyHash("$argon2id$v=19$m=19456,t=2,p=1$x$y")).toBe(false);
  });

  test("N5B-FR-02 · LEGACY_MAXMEM = trần ln=17,r=8,p=2 (≈ 129 MiB, < 132 MiB)", () => {
    expect(LEGACY_MAXMEM).toBe(128 * 131072 * 8 + 128 * 8 * 2 + 1024 * 1024);
    expect(LEGACY_MAXMEM).toBeLessThan(132 * 1024 * 1024);
  });
});

describe("N5B-FR-04 · legacyActive (sunset)", () => {
  const S = new Date("2027-04-19T00:00:00.000Z");
  test("N5B-FR-04 · trước hạn ⇒ true; đúng hạn và sau ⇒ false", () => {
    expect(legacyActive(new Date("2027-04-18T23:59:59.999Z"), S)).toBe(true);
    expect(legacyActive(S, S)).toBe(false);
    expect(legacyActive(new Date("2027-05-01T00:00:00.000Z"), S)).toBe(false);
  });
  test("N5B-FR-04 · mặc định 2027-04-19", () => {
    expect(DEFAULT_LEGACY_SUNSET.toISOString()).toBe("2027-04-19T00:00:00.000Z");
  });
});
