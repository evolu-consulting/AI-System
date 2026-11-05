// CR-121 C-7 · lớp 4: nguồn mục hàng việc của Sổ Hợp Tác cho `GET /pack/nav` (kit) — ĐỘC LẬP gói Community. Mục "Chờ tôi duyệt"
// (cap `contracts.review`) hiện khi người xem (nội bộ, có quyền đọc gói) có việc duyệt mở HOẶC có vai duyệt trong quy trình ĐANG GÁN
// cho khe `contracts.approval`; số = task duyệt mở người đó quyết được. Lọc theo `user.tenantId` (đọc scope user + scope system có
// `tenant_id` tường minh trong `PackRunsPort.inboxOf`). Engine tắt (không có cầu) ⇒ không mục.
import type { AuthUser } from "../../../lib/auth.middleware";
import { type PackAccessView, packAccessInput } from "../kit/adapters/pack-guard.middleware";
import { packNavRegistry } from "../kit/adapters/pack-nav-registry";
import type { PackNavSource } from "../kit/application/pack-nav.ports";
import type { PackRunsBridge } from "../kit/application/pack-runs.ports";
import { packActionsFor } from "../kit/domain/pack-access.rules";

const KEY = "contracts";
export const CONTRACTS_APPROVAL_SLOT = "contracts.approval";

export function contractsNavSource(
  canRead: (u: AuthUser) => Promise<boolean>,
  runs: PackRunsBridge | undefined,
): PackNavSource {
  return {
    pack: KEY,
    async caps(u) {
      const port = runs?.port;
      if (!port?.inboxOf || u.userKind === "external" || !(await canRead(u))) return [];
      const r = await port.inboxOf(
        { userId: u.userId, tenantId: u.tenantId, role: "member" },
        KEY,
        CONTRACTS_APPROVAL_SLOT,
      );
      return r.approver ? [{ cap: "contracts.review", count: r.count }] : [];
    },
  };
}

export const mountContractsNav = (view: PackAccessView, runs: PackRunsBridge | undefined): void =>
  packNavRegistry.register(
    contractsNavSource(
      async (u) => packActionsFor(await packAccessInput(view, KEY, u)).includes("read"),
      runs,
    ),
  );
