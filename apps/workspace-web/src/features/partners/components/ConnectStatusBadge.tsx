// CR-161 · nhãn tình trạng kết nối (đã kết nối / đã gửi lời mời / chờ bạn trả lời / bị từ chối / chưa kết nối).
import type { ConnectStatus } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { type ConnectTone, statusTone } from "../lib/connect";

const TONE: Record<ConnectTone, string> = {
  ok: "bg-ok-bg text-ok",
  wait: "bg-soon-bg text-soon",
  error: "bg-late-bg text-late",
  none: "bg-sunk text-dim",
};

export function ConnectStatusBadge({ status }: { status: ConnectStatus }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="connect-status"
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
        TONE[statusTone(status)],
      )}
    >
      {t(`contracts.connect.status.${status}`)}
    </span>
  );
}
