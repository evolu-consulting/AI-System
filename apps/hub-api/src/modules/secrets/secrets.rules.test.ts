// HUB-FR-68 · HUB-BR-15 · plan H4b-1 §2.1: unit `secrets.rules.ts` (bổ sung ca biên ngoài test khoá R01–R16).
import { describe, expect, it } from "bun:test";
import {
  canManageSecret,
  credentialTenant,
  decodeSecretCursor,
  encodeSecretCursor,
} from "./secrets.rules";

const A = "a4b10000-0000-4000-8000-0000000000a1";

describe("HUB-BR-15 · secrets.rules", () => {
  it("member ở route tenant với tenant phiên: credentialTenant trả tenant phiên (quyền chặn ở canManageSecret)", () => {
    expect(credentialTenant({ userId: A, tenantId: A, role: "member" }, undefined, "read")).toBe(A);
    expect(canManageSecret("member", "source_credential", "tenant")).toBe(false);
  });
  it("HUB-FR-68 · cursor có ký tự Unicode trong name khứ hồi; mảng 4 phần tử ⇒ undefined", () => {
    const k: [string, string, string] = ["kh_api_key", "khoá-đặc-biệt", A];
    expect(decodeSecretCursor(encodeSecretCursor(k))).toEqual(k);
    const four = Buffer.from(JSON.stringify(["a", "b", "c", "d"])).toString("base64url");
    expect(decodeSecretCursor(four)).toBeUndefined();
  });
});
