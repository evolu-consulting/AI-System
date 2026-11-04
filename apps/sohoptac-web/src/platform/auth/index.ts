// CR-118 · cr118-auth · cổng duy nhất của `platform/auth` (một phiên `X-App: contracts` cho web gộp; login gộp
// password → đổi mật khẩu bắt buộc → TOTP; guard theo quyền module). Spec: docs/specs/cr118-auth/tasks.md.
// TODO(cr118-community-module): màn đăng nhập riêng của community-web (`ui/Login.tsx`, `api/auth.ts`, `api/session.ts`) bỏ;
// module community dùng phiên + `useLoginFlow`/`ChangePasswordForm`/`TotpForm` từ đây (không tạo phiên `community`).
// TODO(cr118-feature-gate): nối `setAppsSource` với `/pack/me.apps`.

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
export { type LoginFlow, useLoginFlow } from "./hooks/use-login-flow";
export { currentCaps, setAppsSource } from "./lib/access";
export { errorOf, type LoginMessage, newPasswordError } from "./lib/login-errors";
export type { AppsSource, AuthPort } from "./port";
export { CONTRACTS_APP, session } from "./session";
export { ChangePasswordForm, TotpForm } from "./ui/StepForms";
