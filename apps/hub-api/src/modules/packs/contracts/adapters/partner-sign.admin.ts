// CR-182 · «quản trị công ty» cho việc gửi lại link ký của đối tác (một nguồn cho route `resend`, `GET partner-sign` và phiên ký — G1).
import type { Context } from "hono";
import {
  checkPackAccess,
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
} from "../../kit/public";

/** Quản trị công ty = tenant_admin ∨ có quyền `admin` của gói. */
export async function isResendAdmin(
  view: PackAccessView,
  c: Context<PackGuardVars>,
): Promise<boolean> {
  const user = c.get("user");
  if (user.role === "tenant_admin") return true;
  const i = await packAccessInput(view, "contracts", user);
  return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
}
