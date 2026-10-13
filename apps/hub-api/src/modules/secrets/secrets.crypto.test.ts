// HUB-FR-68 · HUB-FR-04 · AC-H4b1-06 · plan H4b-1 §2.2, §4: unit `secrets.crypto.ts` — lý do boot + khứ hồi.
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  checkHubSecretsKey,
  openHubSecret,
  parseHubSecretsKey,
  sealHubSecret,
  selfTestHubSecretsKey,
} from "./secrets.crypto";

const b64 = (n = 32) => randomBytes(n).toString("base64");
const META = {
  id: "a4b10000-0000-4000-8000-0000000000aa",
  kind: "kh_api_key",
  tenantId: null,
} as const;

describe("HUB-FR-68 · checkHubSecretsKey (boot, plan §4)", () => {
  it("vắng/rỗng ⇒ missing; 16 byte / rác ⇒ invalid", () => {
    expect([
      checkHubSecretsKey(undefined, undefined),
      checkHubSecretsKey("", undefined),
      checkHubSecretsKey(b64(16), undefined),
      checkHubSecretsKey("rác!!", undefined),
    ]).toEqual([
      { ok: false, reason: "missing" },
      { ok: false, reason: "missing" },
      { ok: false, reason: "invalid" },
      { ok: false, reason: "invalid" },
    ]);
  });
  it("HUB-FR-04 · trùng master ⇒ same_as_master; khác master/master vắng ⇒ ok", () => {
    const k = b64();
    expect(checkHubSecretsKey(k, k)).toEqual({ ok: false, reason: "same_as_master" });
    expect(checkHubSecretsKey(k, b64()).ok).toBe(true);
    expect(checkHubSecretsKey(k, undefined).ok).toBe(true);
  });
  it("khoá hỏng độ dài ⇒ self-test ném message cố định", () => {
    expect(() => selfTestHubSecretsKey({ version: 1, key: new Uint8Array(5) })).toThrow(
      "HUB_SECRETS_KEY tự kiểm thất bại",
    );
  });
});

describe("HUB-FR-68 · seal/open", () => {
  it("khứ hồi; key_version của khoá vào sealed", () => {
    const k = parseHubSecretsKey(b64(), 3);
    const s = sealHubSecret(k, META, "giá-trị-QC-unit");
    expect(s.keyVersion).toBe(3);
    expect(openHubSecret(k, META, s)).toBe("giá-trị-QC-unit");
  });
  it("bản mã ngắn hơn tag / iv sai độ dài ⇒ lỗi cố định", () => {
    const k = parseHubSecretsKey(b64());
    const bad = { ciphertext: new Uint8Array(4), iv: new Uint8Array(12), keyVersion: 1 };
    expect(() => openHubSecret(k, META, bad)).toThrow("hub-secrets: giải mã thất bại");
    const s = sealHubSecret(k, META, "x".repeat(10));
    expect(() => openHubSecret(k, META, { ...s, iv: new Uint8Array(8) })).toThrow(
      "hub-secrets: giải mã thất bại",
    );
  });
});

describe("HUB-FR-68 · RV1 #1 · AAD độc lập hoa/thường của id/tenant", () => {
  it("seal bằng id + tenant HOA, open bằng dạng thường (như Postgres trả) ⇒ đọc được", () => {
    const k = parseHubSecretsKey(b64());
    const T = "a1000000-0000-4000-8000-00000000abcd";
    const up = {
      id: META.id.toUpperCase(),
      kind: "source_credential",
      tenantId: T.toUpperCase(),
    } as const;
    const low = { id: META.id, kind: "source_credential", tenantId: T } as const;
    expect(openHubSecret(k, low, sealHubSecret(k, up, "v"))).toBe("v");
  });
});
