// CHAT-AC-54…56 · PF3: đầu trang `/runs/$id` — tên quy trình (heading) + `!key` + badge trạng thái; đường quay lại và
// "Mở luồng trong phòng" (chỉ `full`); nút "Huỷ lượt chạy" (PF1 `CancelRunButton`, chỉ `can_cancel`).
import type { ProcessRunView } from "@ai/contracts/chat";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CancelRunButton } from "../../run-block/components/CancelRunButton";
import { RunStatusBadge } from "../../shared/components/RunStatusBadge";
import { RoomBackLink } from "./RoomBackLink";

type Props = { view: ProcessRunView; onCancelled: () => void };

export function RunHeader({ view, onCancelled }: Props) {
  const { t } = useTranslation();
  const full = view.access === "full" ? view : null;
  // Cần người quyết mà người xem quyết được ⇒ "Huỷ lượt chạy" đã là một lựa chọn của thẻ quyết (tránh hai nút trùng tên).
  const decides = full?.status === "needs_decision" && full.decision?.can_decide === true;
  const canCancel = (full ? full.can_cancel : view.can_cancel) && !decides;

  return (
    <header className="flex flex-col gap-2 border-b border-border px-4 py-3">
      {full &&
        (full.origin.kind === "room" && full.origin.room_id ? (
          <RoomBackLink roomId={full.origin.room_id} />
        ) : full.origin.kind === "conversation" ? (
          <Link
            to="/c/$id"
            params={{ id: full.origin.conversation_id ?? "" }}
            className="text-caption font-medium text-muted-foreground hover:text-foreground"
          >
            ‹ {t("process.inbox.run.back.ai")}
          </Link>
        ) : null)}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-base font-semibold">{view.process.name}</h1>
        <span className="font-mono text-caption text-muted-foreground">!{view.process.key}</span>
        <RunStatusBadge status={view.status} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {full?.thread && (
          <Link
            to="/rooms/$id"
            params={{ id: full.thread.room_id }}
            search={{ flow: full.thread.flow_id }}
            className="text-caption font-medium text-primary underline-offset-2 hover:underline"
          >
            {t("process.inbox.run.openFlow")}
          </Link>
        )}
        <CancelRunButton runId={view.id} canCancel={canCancel} onCancelled={onCancelled} />
      </div>
    </header>
  );
}
