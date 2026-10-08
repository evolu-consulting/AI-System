// HUB-FR-101 · X2b D9, §4, Q5: người khác (không phải người gửi lượt) thấy lượt đang chờ — chỉ tên người hỏi, không mô tả
// hành động/tham số (BE cũng không gửi chi tiết `side_effect` cho họ).
import type { RoomAsk } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";

export function WaitingNote({ kind, callerName }: { kind: RoomAsk["kind"]; callerName: string }) {
  const { t } = useTranslation();
  const key = kind === "side_effect" ? "roomAgent.waitConfirm" : "roomAgent.waitInput";
  return (
    <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      {t(key, { name: callerName })}
    </p>
  );
}
