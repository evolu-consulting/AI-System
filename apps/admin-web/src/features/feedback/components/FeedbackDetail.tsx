// feedback · chi tiết một góp ý: nội dung, trang/app/phiên bản, tệp đính kèm, đổi trạng thái + trả lời (user thấy phản hồi trong khung góp ý).
import { FEEDBACK_STATUSES, type FeedbackItem, type FeedbackStatus } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { downloadAttachment, useUpdateFeedback } from "../api";

const SELECT = "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";

export function FeedbackDetail({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateFeedback();
  const [status, setStatus] = useState<FeedbackStatus>(item.status);
  const [reply, setReply] = useState(item.reply ?? "");
  const dirty =
    status !== item.status || (reply.trim() !== "" && reply.trim() !== (item.reply ?? ""));
  const save = async () => {
    await update.mutateAsync({
      id: item.id,
      body: {
        ...(status !== item.status ? { status } : {}),
        ...(reply.trim() !== "" && reply.trim() !== (item.reply ?? "")
          ? { reply: reply.trim() }
          : {}),
      },
    });
    notifySuccess(t("feedbackAdmin.saved"));
    onClose();
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t(`feedbackAdmin.kind.${item.kind}`)}</SheetTitle>
          <SheetDescription>
            {item.tenant_name} · {item.user_name} · {item.created_at.slice(0, 16).replace("T", " ")}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <p className="whitespace-pre-wrap text-body">{item.message}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label text-muted-foreground">
            <dt>{t("feedbackAdmin.col.app")}</dt>
            <dd>{item.app}</dd>
            <dt>{t("feedbackAdmin.version")}</dt>
            <dd>{item.app_version || "—"}</dd>
            <dt>{t("feedbackAdmin.page")}</dt>
            <dd className="break-all font-mono">{item.page_url || "—"}</dd>
          </dl>
          {item.files.length > 0 ? (
            <ul className="space-y-1">
              {item.files.map((f) => (
                <li key={f.id}>
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => void downloadAttachment(item.id, f.id, f.name)}
                  >
                    {f.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="block text-label">
            {t("feedbackAdmin.col.status")}
            <select
              className={`${SELECT} mt-1 block`}
              value={status}
              onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
            >
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`feedbackAdmin.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="feedback-reply" className="block text-label">
            {t("feedbackAdmin.reply")}
          </label>
          <div>
            <Textarea
              id="feedback-reply"
              className="mt-1"
              rows={5}
              maxLength={4000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t("feedbackAdmin.replyHint")}
            />
          </div>
          <Button disabled={!dirty || update.isPending} onClick={() => void save()}>
            {t("feedbackAdmin.save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
