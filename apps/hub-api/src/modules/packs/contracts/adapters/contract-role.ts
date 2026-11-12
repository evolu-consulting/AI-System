// CR-127 · Z8: vai của người gọi trong gói hợp đồng (admin / write) từ cache cấu hình — 0 SQL khi nóng. Dùng cho `can.delete` và guard xoá.
import { checkPackAccess, type PackAccessView, packAccessInput } from "../../kit/public";
import type { DeleteRole } from "../domain/delete-contract.rules";

export const contractRoleOf =
  (view: PackAccessView) =>
  async (who: { tenantId: string; userId: string }): Promise<DeleteRole> => {
    const i = await packAccessInput(view, "contracts", { ...who, userKind: "internal" });
    const ok = (a: "admin" | "write") =>
      checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction[a] }) === "ok";
    return { admin: ok("admin"), write: ok("write") };
  };
