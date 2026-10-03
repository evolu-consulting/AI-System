// ADM-FR-08 · M4-R16 · máy trạng thái trang 2FA (plan-frontend §3.6).
import { describe, expect, test } from "bun:test";
import {
  backupFileName,
  backupFileText,
  groupSecret,
  isUnsaved,
  stepNumber,
  TOTP_IDLE,
  type TotpStep,
  totpReducer,
} from "./totp-steps";

const setup = { secret: "A".repeat(32), otpauth_url: "otpauth://totp/x", qr_svg: "data:x" };
const codes = Array.from({ length: 10 }, (_, i) => `abc${i}-defg`);

describe("ADM-FR-08 · totpReducer", () => {
  test("luồng bật: idle → reauth → scan → verify → backup → idle", () => {
    let s: TotpStep = TOTP_IDLE;
    s = totpReducer(s, { type: "start" });
    expect(s.step).toBe("reauth");
    s = totpReducer(s, { type: "setupLoaded", setup });
    expect(s).toEqual({ step: "scan", setup });
    s = totpReducer(s, { type: "next" });
    expect(s).toEqual({ step: "verify", setup });
    expect(totpReducer(s, { type: "back" })).toEqual({ step: "scan", setup });
    s = totpReducer(s, { type: "codesIssued", codes, source: "enable" });
    expect(s).toEqual({ step: "backup", codes, source: "enable" });
    expect(isUnsaved(s)).toBe(true);
    s = totpReducer(s, { type: "reset" });
    expect(s).toEqual(TOTP_IDLE);
    expect(isUnsaved(s)).toBe(false);
  });

  test("hành động sai bước bị bỏ qua", () => {
    expect(totpReducer(TOTP_IDLE, { type: "setupLoaded", setup })).toEqual(TOTP_IDLE);
    expect(totpReducer(TOTP_IDLE, { type: "next" })).toEqual(TOTP_IDLE);
    const reauth: TotpStep = { step: "reauth" };
    expect(totpReducer(reauth, { type: "start" })).toBe(reauth);
  });

  test("tạo lại mã từ idle đi thẳng tới bước lưu mã", () => {
    const s = totpReducer(TOTP_IDLE, { type: "codesIssued", codes, source: "regen" });
    expect(s).toEqual({ step: "backup", codes, source: "regen" });
  });

  test("stepNumber: scan 1, verify 2, backup 3, còn lại null", () => {
    expect(stepNumber({ step: "scan", setup })).toBe(1);
    expect(stepNumber({ step: "verify", setup })).toBe(2);
    expect(stepNumber({ step: "backup", codes, source: "enable" })).toBe(3);
    expect(stepNumber({ step: "reauth" })).toBeNull();
    expect(stepNumber(TOTP_IDLE)).toBeNull();
  });
});

describe("ADM-FR-08 · tiện ích hiển thị", () => {
  test("groupSecret nhóm 4 ký tự", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
  test("backupFileText mỗi mã một dòng", () => {
    expect(backupFileText("H", ["a", "b"])).toBe("H\n\na\nb\n");
  });
  test("backupFileName theo tenant + username", () => {
    expect(backupFileName("acme", "thu.ha")).toBe("ai-system-backup-codes-acme-thu.ha.txt");
  });
});
