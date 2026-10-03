// ADM-FR-08 · contract 2FA (plan-cd §4.1–4.2).
import { describe, expect, test } from "bun:test";
import {
  BackupCodesResponseSchema,
  TotpDisableRequestSchema,
  TotpEnableRequestSchema,
  TotpSetupResponseSchema,
  TotpVerifyRequestSchema,
} from "./totp";

describe("ADM-FR-08 · totp contract", () => {
  test("backup_code nhận chữ HOA, chuẩn hoá về thường", () => {
    const r = TotpVerifyRequestSchema.parse({ totp_token: "a.b.c", backup_code: "K7P2-9XQM" });
    expect(r).toEqual({ totp_token: "a.b.c", backup_code: "k7p2-9xqm" });
  });

  test("disable: đúng một trong code / backup_code", () => {
    const pw = { current_password: "x" };
    expect(TotpDisableRequestSchema.safeParse({ ...pw, code: "123456" }).success).toBe(true);
    expect(TotpDisableRequestSchema.safeParse({ ...pw, backup_code: "k7p29xqm" }).success).toBe(
      true,
    );
    const both = { ...pw, code: "123456", backup_code: "k7p29xqm" };
    expect(TotpDisableRequestSchema.safeParse(both).success).toBe(false);
    expect(TotpDisableRequestSchema.safeParse(pw).success).toBe(false);
  });

  test("enable: code 6 số, strict", () => {
    expect(TotpEnableRequestSchema.safeParse({ code: "012345" }).success).toBe(true);
    expect(TotpEnableRequestSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(TotpEnableRequestSchema.safeParse({ code: "123456", x: 1 }).success).toBe(false);
  });

  test("setup response + backup codes", () => {
    const s = {
      secret: "A".repeat(32),
      otpauth_url: "otpauth://totp/AI%20System:acme?secret=A",
      qr_svg: "data:image/svg+xml;base64,PHN2Zz4=",
      account_label: "acme · binh",
      expires_in: 600,
    };
    expect(TotpSetupResponseSchema.safeParse(s).success).toBe(true);
    expect(TotpSetupResponseSchema.safeParse({ ...s, expires_in: 300 }).success).toBe(false);
    const codes = Array.from({ length: 10 }, () => "k7p2-9xqm");
    expect(BackupCodesResponseSchema.safeParse({ backup_codes: codes }).success).toBe(true);
    expect(BackupCodesResponseSchema.safeParse({ backup_codes: codes.slice(1) }).success).toBe(
      false,
    );
  });
});
