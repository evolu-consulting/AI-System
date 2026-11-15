// CR-161 · khối «Công ty đã kết nối» ở trang Đối tác: mỗi dòng = tên + nhãn «Đã kết nối» + «Ngắt kết nối» (công ty chưa có hợp đồng vẫn có dòng).
// Nhân viên không Toàn quyền: không gọi API, chỉ thấy băng giải thích (không có nút mời / ngắt / đồng ý).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { btnClass } from "~/components/ui/Btn";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { useLinks } from "../hooks/use-connect";
import { partnerSearchOf } from "../lib/connect";
import { ConnectStatusBadge } from "./ConnectStatusBadge";
import { DisconnectButton } from "./DisconnectButton";

export function ConnectedPanel() {
  const { t } = useTranslation();
  const { owner } = useMe();
  const q = useLinks("connected", owner);
  if (!owner)
    return (
      <p
        data-testid="connect-staff-note"
        className="mb-3 rounded-xl border border-rule bg-sunk px-4 py-3 text-[13px] text-dim"
      >
        {t("contracts.connect.staffNote")}
      </p>
    );
  const items = q.data?.items ?? [];
  if (q.error)
    return (
      <p role="alert" className="mb-3 text-[13px] text-late">
        {t("contracts.connect.err.failed")}
      </p>
    );
  if (items.length === 0) return null;
  return (
    <Panel className="mb-3">
      <h2 className="px-5 pt-3 text-[13px] font-semibold text-dim">
        {t("contracts.connect.connectedTitle")}
      </h2>
      <ul data-testid="connected-list">
        {items.map((l) => (
          <li
            key={l.tenant_id}
            className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3 last:border-0"
          >
            <span className="min-w-0 flex-1 basis-56 truncate font-semibold">{l.legal_name}</span>
            <ConnectStatusBadge status="connected" />
            {/* Spec §8: `/messages?company=<id>`. Route thật là `/contracts/messages`; lọc theo công ty do lát 6 nhận `company`. */}
            <Link
              to="/contracts/messages"
              search={{ company: l.tenant_id } as never}
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
            <DisconnectButton tenant={l.tenant_id} name={l.legal_name} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
