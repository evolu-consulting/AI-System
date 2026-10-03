// ADM-FR-08 · M4-R16 · plan-frontend §3.6 · máy trạng thái trang 2FA: idle → reauth → scan → verify → backup → idle.
// Secret và mã dự phòng chỉ nằm trong state này (bộ nhớ, D11); về `idle` là xoá.
import type { TotpSetupResponse } from "@ai/contracts";

export type TotpSetup = Pick<TotpSetupResponse, "secret" | "otpauth_url" | "qr_svg">;

export type TotpStep =
  | { step: "idle" }
  | { step: "reauth" }
  | { step: "scan"; setup: TotpSetup }
  | { step: "verify"; setup: TotpSetup }
  | { step: "backup"; codes: string[]; source: "enable" | "regen" };

export type TotpAction =
  | { type: "start" }
  | { type: "setupLoaded"; setup: TotpSetup }
  | { type: "next" }
  | { type: "back" }
  | { type: "codesIssued"; codes: string[]; source: "enable" | "regen" }
  | { type: "reset" };

/** Giá trị hộp thoại Tắt / Tạo lại (mật khẩu rỗng khi không cần). */
export type TotpConfirmValues = { password: string; code: string };

export const TOTP_IDLE: TotpStep = { step: "idle" };

/** Bước hiển thị "Bước {n}/3" (reauth/idle không đánh số). */
export function stepNumber(s: TotpStep): number | null {
  if (s.step === "scan") return 1;
  if (s.step === "verify") return 2;
  if (s.step === "backup") return 3;
  return null;
}

/** Bước 3 còn mã chưa xác nhận đã lưu → chặn rời trang. */
export const isUnsaved = (s: TotpStep): boolean => s.step === "backup";

export function totpReducer(state: TotpStep, action: TotpAction): TotpStep {
  switch (action.type) {
    case "start":
      return state.step === "idle" ? { step: "reauth" } : state;
    case "setupLoaded":
      return state.step === "reauth" ? { step: "scan", setup: action.setup } : state;
    case "next":
      return state.step === "scan" ? { step: "verify", setup: state.setup } : state;
    case "back":
      return state.step === "verify" ? { step: "scan", setup: state.setup } : state;
    case "codesIssued":
      return { step: "backup", codes: action.codes, source: action.source };
    case "reset":
      return TOTP_IDLE;
  }
}

/** "JBSWY3DP…" → "JBSW Y3DP …" (nhóm 4, dễ gõ tay). */
export const groupSecret = (secret: string): string => secret.replace(/(.{4})(?=.)/g, "$1 ");

/** Nội dung file .txt mã dự phòng: tiêu đề + mỗi mã một dòng. */
export function backupFileText(heading: string, codes: string[]): string {
  return `${heading}\n\n${codes.join("\n")}\n`;
}

export const backupFileName = (tenant: string, username: string): string =>
  `ai-system-backup-codes-${tenant}-${username}.txt`;
