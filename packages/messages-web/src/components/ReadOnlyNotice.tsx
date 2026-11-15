// CR-169 · lát 6 · thay ô soạn khi cuộc `partner` chỉ đọc (ngắt kết nối / người kia không còn dùng Sổ Hợp Tác): nói lý do, còn xem được tin cũ.
import type { ConversationDetail } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { readOnlyReason } from "../lib/perms";

export function ReadOnlyNotice({ d }: { d: ConversationDetail }) {
  const { t } = useTranslation();
  const why = readOnlyReason(d);
  if (!why) return null;
  const company = d.company?.name ?? "";
  return (
    <p
      role="status"
      data-testid="read-only-notice"
      data-reason={why}
      className="m-0 shrink-0 border-t border-rule bg-sunk px-4 py-3 text-label text-dim"
    >
      {why === "disconnected"
        ? t("contracts.messages.readOnly.disconnected", { company })
        : t("contracts.messages.readOnly.peerGone", { name: d.peer?.name ?? "", company })}
    </p>
  );
}
