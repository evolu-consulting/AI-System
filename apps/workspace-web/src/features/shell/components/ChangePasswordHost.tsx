// CR-187 · gắn một lần ở Shell: hiện hộp «Đổi mật khẩu» khi menu tài khoản yêu cầu.
import { closeChangePassword, useChangePasswordOpen } from "../lib/change-password-bus";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

export function ChangePasswordHost() {
  return useChangePasswordOpen() ? <ChangePasswordDialog onClose={closeChangePassword} /> : null;
}
