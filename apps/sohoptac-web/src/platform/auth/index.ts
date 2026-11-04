// CR-118 · cr118-auth · cổng duy nhất của `platform/auth` (một phiên `X-App: contracts` cho web gộp; login gộp
// password → đổi mật khẩu bắt buộc → TOTP; guard theo quyền module). Spec: docs/specs/cr118-auth/tasks.md.
// TODO(cr118-community-module): màn đăng nhập riêng của community-web (`ui/Login.tsx`, `api/auth.ts`, `api/session.ts`) bỏ;
// module community dùng phiên + `useLoginFlow`/`ChangePasswordForm`/`TotpForm` từ đây (không tạo phiên `community`).
// TODO(cr118-feature-gate): nối `setAppsSource` với `/pack/me.apps`.
export { currentCaps, setAppsSource } from "./application/access";
export { type LoginFlow, useLoginFlow } from "./application/use-login-flow";
export { errorOf, type LoginMessage, newPasswordError } from "./domain/login-errors";
export {
  type AccessCaps,
  bouncesToSso,
  canOpen,
  capsOf,
  HOME_COMMUNITY,
  HOME_CONTRACTS,
  homeFor,
  type LoginStep,
  landing,
  moduleOf,
  stepOf,
} from "./domain/login-machine";
export { safeNext } from "./domain/next";
export type { AppsSource, AuthPort } from "./port";
export { CONTRACTS_APP, session } from "./session";
export { ChangePasswordForm, TotpForm } from "./ui/StepForms";
