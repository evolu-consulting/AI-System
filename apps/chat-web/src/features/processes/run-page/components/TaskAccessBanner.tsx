// CHAT-AC-56 · HUB-BR-25 · PF3: banner người xem ngoài phòng (`access:"task"`). Có việc ⇒ "chỉ xem phần cần xử lý…";
// người bắt đầu đã rời phòng (U5, `my_tasks=[]`) ⇒ chuỗi `thread.left` ("Bạn không còn ở phòng này…"). plan-thread §5(c).
import { useTranslation } from "react-i18next";

export function TaskAccessBanner({ hasTasks }: { hasTasks: boolean }) {
  const { t } = useTranslation();
  return (
    <p
      role="note"
      className="rounded-md border border-warning-bg bg-warning-bg px-3 py-2 text-caption text-warning"
    >
      {hasTasks ? t("process.inbox.run.banner") : t("process.thread.left")}
    </p>
  );
}
