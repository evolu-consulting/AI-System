// ADM-NFR-01 · argon2id đúng tham số spec M1 §6; verify hash hỏng → false.
import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./password";

describe("ADM-NFR-01 · password", () => {
  test("ADM-NFR-01 · hash argon2id m=19456,t=2,p=1; verify đúng/sai", async () => {
    const h = await hashPassword("Mat-Khau-Dung-1");
    expect(h).toStartWith("$argon2id$v=19$m=19456,t=2,p=1$");
    expect(await verifyPassword("Mat-Khau-Dung-1", h)).toBe(true);
    expect(await verifyPassword("Mat-Khau-Sai-1", h)).toBe(false);
  });

  test("ADM-NFR-01 · hash không phải PHC → false, không ném", async () => {
    expect(await verifyPassword("x", "khong-phai-hash")).toBe(false);
  });
});
