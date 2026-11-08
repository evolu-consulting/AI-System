// CR-121 C-7 · lớp 4: nguồn mục hàng việc của Sổ Hợp Tác cho `GET /pack/nav` (kit) — ĐỘC LẬP gói Community. Mục "Chờ tôi duyệt"
// (cap `contracts.review`) hiện khi người xem (nội bộ, có quyền đọc gói) có việc duyệt mở HOẶC có vai duyệt trong quy trình ĐANG GÁN
// cho khe `contracts.approval`; số = task duyệt mở người đó quyết được. Lọc theo `user.tenantId` (đọc scope user + scope system có
// `tenant_id` tường minh trong `PackRunsPort.inboxOf`). Engine tắt (không có cầu) ⇒ không mục.
import { CONTRACTS_PARTNER_CONFIRM_FEATURE } from "@ai/contracts/tenants";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { PackNavSource, PackRunsBridge } from "../kit/public";
import {
  type PackAccessView,
  packAccessInput,
  packActionsFor,
  packNavRegistry,
  tenantFeatureOn,
} from "../kit/public";

const KEY = "contracts";
export const CONTRACTS_APPROVAL_SLOT = "contracts.approval";
/** CR-124 · q4 · mục «Hợp đồng đối tác gửi» (cap `contracts.partner`): chỉ khi công ty bật tính năng `contracts-partner-confirm`. */
export const PARTNER_INBOX_CAP = "contracts.partner";
export const PARTNER_FEATURE = CONTRACTS_PARTNER_CONFIRM_FEATURE;

export function contractsNavSource(
  canRead: (u: AuthUser) => Promise<boolean>,
  runs: PackRunsBridge | undefined,
  partnerOn: (u: AuthUser) => Promise<boolean> = async () => false,
): PackNavSource {
  return {
    pack: KEY,
    async caps(u) {
      if (u.userKind === "external" || !(await canRead(u))) return [];
      const out: { cap: string; count: number }[] = [];
      if (await partnerOn(u)) out.push({ cap: PARTNER_INBOX_CAP, count: 0 });
      const port = runs?.port;
      if (!port?.inboxOf) return out;
      const r = await port.inboxOf(
        { userId: u.userId, tenantId: u.tenantId, role: "member" },
        KEY,
        CONTRACTS_APPROVAL_SLOT,
      );
      if (r.approver) out.push({ cap: "contracts.review", count: r.count });
      return out;
    },
  };
}

export const mountContractsNav = (view: PackAccessView, runs: PackRunsBridge | undefined): void =>
  packNavRegistry.register(
    contractsNavSource(
      async (u) => packActionsFor(await packAccessInput(view, KEY, u)).includes("read"),
      runs,
      (u) => tenantFeatureOn(view, PARTNER_FEATURE, u.tenantId),
    ),
  );
