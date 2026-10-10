// CHAT-AC-55 · PF3: một thẻ thông báo trong DM "Quy trình". Tiêu đề theo `kind`; task còn mở ⇒ `TaskPanel` (tự mở
// 3 thẻ mới nhất, còn lại nút "Xem & xử lý"); đã đóng ⇒ dòng kết quả. Link "Mở trang lượt chạy ›".
import type { ProcessNotice, TaskResult } from "@ai/contracts/chat";
import { Link } from "@tanstack/react-router";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskPanel } from "../../shared/components/TaskPanel";
import { useReviewTasks } from "../api";
import { noticeHasTask, noticeTitleKey } from "../lib/notice";

type Props = { notice: ProcessNotice; autoExpand: boolean };

export const NoticeCard = memo(function NoticeCard({ notice, autoExpand }: Props) {
  const { t } = useTranslation();
  const tasks = useReviewTasks();
  const title = t(noticeTitleKey(notice.kind), {
    process: notice.process_name,
    stage: notice.stage_name ?? "",
  });

  const openTask =
    noticeHasTask(notice) && notice.task_id
      ? tasks.data?.items.find((it) => it.task.id === notice.task_id)
      : undefined;

  const [open, setOpen] = useState(autoExpand);
  // E-P12: người xem tự xử lý xong ⇒ task rời danh sách mở; nhớ kết quả để hiện "Bạn · <kết quả>" (khác superseded khi người khác xử lý).
  const [done, setDone] = useState<TaskResult | null>(null);

  return (
    <article
      aria-label={title}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      {openTask ? (
        open ? (
          <TaskPanel runId={openTask.process_run.id} task={openTask.task} onResolved={setDone} />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="self-start rounded-md border border-input px-2.5 py-1 text-caption font-medium hover:bg-muted"
          >
            {t("process.inbox.notice.expand")}
          </button>
        )
      ) : done ? (
        <p className="text-caption text-secondary-foreground">
          {t("process.inbox.notice.resolvedByYou", {
            result: t(`process.common.result.${done}`),
          })}
        </p>
      ) : (
        noticeHasTask(notice) && (
          <p className="text-caption text-muted-foreground">
            {t("process.common.result.superseded")}
          </p>
        )
      )}
      <Link
        to="/runs/$id"
        params={{ id: notice.process_run_id }}
        className="self-start text-caption font-medium text-primary underline-offset-2 hover:underline"
      >
        {t("process.inbox.notice.openRun")} ›
      </Link>
    </article>
  );
});
