// HUB-FR-68 · PC2-R10 · test luật validate khoá nguồn.
import { describe, expect, it } from "bun:test";
import {
  credentialNameError,
  credentialTokenError,
  validateCredentialCreate,
} from "./credential-schema";

describe("credentialNameError", () => {
  it("nhận tên hợp lệ 2–64 ký tự chữ/số/_/-", () => {
    expect(credentialNameError("gh-acme-pat")).toBeUndefined();
    expect(credentialNameError("  gh_acme  ")).toBeUndefined(); // trim trước khi khớp
  });
  it("từ chối tên quá ngắn, ký tự lạ, quá dài", () => {
    expect(credentialNameError("a")).toBe("process.sources.credential.err.name");
    expect(credentialNameError("gh acme")).toBe("process.sources.credential.err.name");
    expect(credentialNameError("x".repeat(65))).toBe("process.sources.credential.err.name");
  });
});

describe("credentialTokenError", () => {
  it("rỗng ⇒ bắt buộc", () => {
    expect(credentialTokenError("")).toBe("process.sources.credential.err.valueRequired");
  });
  it("ngắn hơn 8 hoặc dài hơn 2048 ⇒ sai độ dài", () => {
    expect(credentialTokenError("short")).toBe("process.sources.credential.err.valueLen");
    expect(credentialTokenError("x".repeat(2049))).toBe("process.sources.credential.err.valueLen");
  });
  it("8–2048 ký tự, KHÔNG trim ⇒ hợp lệ", () => {
    expect(credentialTokenError("github_pat_12345")).toBeUndefined();
    expect(credentialTokenError("   with-spaces-kept   ")).toBeUndefined();
  });
});

describe("validateCredentialCreate", () => {
  it("gộp lỗi theo ô", () => {
    expect(validateCredentialCreate({ name: "a", value: "" })).toEqual({
      name: "process.sources.credential.err.name",
      value: "process.sources.credential.err.valueRequired",
    });
    expect(validateCredentialCreate({ name: "gh-acme", value: "github_pat_12345" })).toEqual({});
  });
});
