import { describe, expect, test } from "bun:test";
import { passwordStrength } from "./strength";

describe("ADM-FR-06 · độ mạnh mật khẩu", () => {
  test("ngắn hoặc ít loại ký tự → weak", () => {
    expect(passwordStrength("Ab1!")).toBe("weak");
    expect(passwordStrength("abcdefghijkl")).toBe("weak");
    expect(passwordStrength("abcdefghij1")).toBe("weak");
  });

  test("3 điểm → medium", () => {
    expect(passwordStrength("Abcdefghij1")).toBe("medium");
  });

  test("≥ 4 điểm → strong", () => {
    expect(passwordStrength("Abcdefghij1!")).toBe("strong");
    expect(passwordStrength("abcdefghijklmn1")).toBe("medium");
    expect(passwordStrength("Test-Passw0rd-1")).toBe("strong");
  });
});
