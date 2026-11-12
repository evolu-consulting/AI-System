// PK-FR-10 · TF5 · nav-v2 · CR-120 · điện thoại: cùng các mục của menu trái (sinh từ manifest) ở thanh dưới, tầm ngón cái; tối đa 5 cột.
// CR-125 · x1: mục "Chờ tôi" (số đỏ = HĐ chờ chính mình ký + duyệt, cùng đọc `GET /my-work` với thẻ Tổng quan) thế chỗ "Sản phẩm & Giá" —
// giám đốc ra ngoài vẫn biết vào đâu để ký. Chỉ khi gói Sổ Hợp Tác bật.
import { Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UnreadBadge } from "~/features/messages/components/UnreadBadge";
import { useUnreadTotal } from "~/features/messages/hooks/use-unread";
import { useInbox } from "~/features/overview/hooks/use-inbox";
import { waitingBadge } from "~/features/overview/lib/waiting";
import type { NavEntry } from "~/shared/kernel/module-manifest";
import { pickBottomItems } from "~/shell/bottom-nav";
import { MODULES } from "~/shell/modules";
import { buildShellNav } from "~/shell/nav";
import { useShellPacks } from "~/shell/use-shell-packs";

const ITEM =
  "relative flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-micro text-dim aria-[current=page]:font-semibold aria-[current=page]:text-act";

function WaitingItem() {
  const { t } = useTranslation();
  const n = waitingBadge(useInbox().count);
  return (
    <Link to="/contracts/approvals" className={ITEM} data-testid="bottom-waiting">
      <span className="relative">
        <ClipboardCheck width={19} height={19} />
        {n && (
          <span
            data-testid="bottom-waiting-count"
            className="tnum absolute -right-3 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-late px-1 text-[10px] font-bold leading-none text-white"
          >
            {n}
          </span>
        )}
      </span>
      <span className="max-w-full truncate">{t("contracts.nav.waiting")}</span>
    </Link>
  );
}

/** CR-132 · mục «Tin nhắn» ở thanh dưới: số đỏ = tổng chưa đọc (cùng một query với menu trái và nút khoang). */
function UnreadIcon({ icon: Icon }: { icon: NavEntry["icon"] }) {
  return (
    <span className="relative">
      <Icon width={19} height={19} />
      <UnreadBadge count={useUnreadTotal()} className="absolute -right-3 -top-2" />
    </span>
  );
}

export function BottomNav() {
  const { t } = useTranslation();
  const packs = useShellPacks();
  const contracts = packs.contracts === true;
  const items = useMemo(() => {
    const all = buildShellNav(MODULES, (p) => packs[p] === true).flatMap((g) => g.items);
    return contracts
      ? pickBottomItems(
          all.filter((n) => !n.to.endsWith("/products")),
          4,
        )
      : pickBottomItems(all, 5);
  }, [packs, contracts]);
  const cols = items.length + (contracts ? 1 : 0);
  if (cols === 0) return null;
  return (
    <nav
      aria-label={t("contracts.shell.navBottom")}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-rule bg-panel md:hidden"
    >
      {items.map((n) => (
        <Link
          key={n.to}
          to={n.to as never}
          activeOptions={{ exact: n.exact === true }}
          className={ITEM}
        >
          {n.unread ? <UnreadIcon icon={n.icon} /> : <n.icon width={19} height={19} />}
          <span className="max-w-full truncate">{t(n.labelKey)}</span>
        </Link>
      ))}
      {contracts && <WaitingItem />}
    </nav>
  );
}
