// CR-121 C-7 · lớp 4: nguồn mục hàng việc của Sổ Hợp Tác cho `GET /pack/nav` (kit) — ĐỘC LẬP gói Community. Mục "Chờ tôi duyệt"
// (cap `contracts.review`) hiện khi người xem (nội bộ, có quyền đọc gói) có việc duyệt mở HOẶC có vai duyệt trong quy trình ĐANG GÁN
// cho khe `contracts.approval`; số = task duyệt mở người đó quyết được. Lọc theo `user.tenantId` (đọc scope user + scope system có
// `tenant_id` tường minh trong `PackRunsPort.inboxOf`). Engine tắt (không có cầu) ⇒ không mục.
import type { Db } from "@ai/db";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { PackNavCap, PackNavSource, PackRunsBridge } from "../kit/public";
import {
  createPackUow,
  type PackAccessView,
  packAccessInput,
  packActionsFor,
  packNavRegistry,
} from "../kit/public";
import { partnerAwaitingCount } from "./adapters/mywork.repo";

const KEY = "contracts";
export const CONTRACTS_APPROVAL_SLOT = "contracts.approval";
/** CR-127 · U6: mục «Hợp đồng đối tác gửi» (cap `contracts.partner`) đã gỡ — HĐ đối tác gửi nằm trong danh sách Hợp đồng (lọc Nguồn). */
export function contractsNavSource(
  canRead: (u: AuthUser) => Promise<boolean>,
  runs: PackRunsBridge | undefined,
  /** CR-127 · RA1 · số HĐ nhận chờ người xem quyết (luồng nhận đối tác, `awaiting_decision`); vắng ⇒ 0. */
  partnerWaiting: (u: AuthUser) => Promise<number> = async () => 0,
): PackNavSource {
  return {
    pack: KEY,
    async caps(u) {
      if (u.userKind === "external" || !(await canRead(u))) return [];
      const review = await reviewCap(runs, u, partnerWaiting);
      return review ? [review] : [];
    },
  };
}

async function reviewCap(
  runs: PackRunsBridge | undefined,
  u: AuthUser,
  partnerWaiting: (u: AuthUser) => Promise<number>,
): Promise<PackNavCap | null> {
  const port = runs?.port;
  // Số = việc duyệt + việc xác nhận mốc (engine: `inboxOf`) + HĐ nhận chờ mình quyết (gói) — mỗi nguồn MỘT câu SQL, song song.
  const [r, partner] = await Promise.all([
    port?.inboxOf
      ? port.inboxOf(
          { userId: u.userId, tenantId: u.tenantId, role: "member" },
          KEY,
          CONTRACTS_APPROVAL_SLOT,
        )
      : Promise.resolve(null),
    partnerWaiting(u),
  ]);
  if (!(r?.approver || partner > 0)) return null;
  return { cap: "contracts.review", count: (r?.count ?? 0) + partner };
}

export const mountContractsNav = (
  view: PackAccessView,
  runs: PackRunsBridge | undefined,
  db?: Db,
): void => {
  const uow = db
    ? createPackUow(db, KEY, (tx, t) => ({ partnerWaiting: () => partnerAwaitingCount(tx, t) }))
    : null;
  packNavRegistry.register(
    contractsNavSource(
      async (u) => packActionsFor(await packAccessInput(view, KEY, u)).includes("read"),
      runs,
      uow
        ? (u) => uow.tenant({ userId: u.userId, tenantId: u.tenantId }, (r) => r.partnerWaiting())
        : undefined,
    ),
  );
};
