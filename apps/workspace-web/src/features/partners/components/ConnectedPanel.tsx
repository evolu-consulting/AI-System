// CR-161 · danh sách «Công ty đã kết nối» (mỗi dòng = tên + «Đã kết nối» + Nhắn tin / Mở trang đối tác / Ngắt kết nối). CR-193: không còn thẻ riêng,
// là phần mở của thẻ «Tìm thấy và kết nối» (DiscoverableCard); đóng ⇒ vẫn nằm trong trang nhưng ẩn (`hidden`).
import type { ConnectLink } from "@ai/contracts/pack-contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { btnClass } from "~/components/ui/Btn";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { partnerSearchOf } from "../lib/connect";
import { ConnectStatusBadge } from "./ConnectStatusBadge";
import { DisconnectButton } from "./DisconnectButton";

export function ConnectedPanel({ items, open }: { items: ConnectLink[]; open: boolean }) {
  const { t } = useTranslation();
  const { owner } = useMe();
  if (items.length === 0) return null;
  return (
    <ul data-testid="connected-list" hidden={!open} className="mt-3">
      {items.map((l) => (
        <li
          key={l.tenant_id}
          className="flex flex-wrap items-center gap-3 border-b border-rule-soft py-3 last:border-0"
        >
          <span className="min-w-0 flex-1 basis-56 truncate font-semibold">{l.legal_name}</span>
          <ConnectStatusBadge status="connected" />
          <Link
            to="/contracts/messages"
            search={{ company: l.tenant_id }}
            className={btnClass("outline", "sm")}
          >
            {t("contracts.connect.message")}
          </Link>
          <Link
            to="/contracts/partners"
            search={partnerSearchOf(l)}
            className={btnClass("outline", "sm")}
          >
            {t("contracts.connect.openPartner")}
          </Link>
          {owner && <DisconnectButton tenant={l.tenant_id} name={l.legal_name} />}
        </li>
      ))}
    </ul>
  );
}
