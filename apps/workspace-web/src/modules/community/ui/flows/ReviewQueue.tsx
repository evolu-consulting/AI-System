// CR-120 · Hàng chờ duyệt bài (người duyệt): MỘT yêu cầu cho cả danh sách; duyệt/từ chối kèm lý do. 409 ⇒ "đã có người xử lý" + làm mới.
import type { ModerationItem } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { useApp } from "../../application/ctx";
import { isConflict, queueReasonKey } from "../../domain/flows";
import { t } from "../../i18n";
import { FlowPage, ListState, ReasonDialog, useFlowList } from "./parts";

export default function ReviewQueuePage() {
  const { api, toast, bump } = useApp();
  const list = useFlowList(async () => (await api.flows.modQueue()).items);
  const [rejecting, setRejecting] = useState<ModerationItem | null>(null);
  // UX-S5 · còn bài "đang kiểm tra" ⇒ nạp lại mỗi 10 giây để bài sang "Cần bạn duyệt" (có nút Duyệt/Ẩn) mà không phải tải lại trang
  const checking = !!list.items?.some((m) => !m.awaitingReview);
  const { reload } = list;
  useEffect(() => {
    if (!checking) return;
    const id = setInterval(reload, 10_000);
    return () => clearInterval(id);
  }, [checking, reload]);

  const decide = async (m: ModerationItem, action: "approve" | "reject", feedback?: string) => {
    try {
      await api.flows.decideModeration(m.id, {
        action,
        ...(m.taskId ? { taskId: m.taskId } : {}),
        ...(feedback ? { feedback } : {}),
      });
      toast(
        t(
          action === "approve"
            ? "community.flows.review.approved"
            : "community.flows.review.rejected",
        ),
      );
      setRejecting(null);
      bump();
    } catch (e) {
      if (!isConflict(e)) throw e;
      toast(t("community.flows.review.conflict"));
      setRejecting(null);
      list.reload();
    }
  };

  return (
    <FlowPage
      title={t("community.flows.review.title")}
      intro={t("community.flows.review.intro")}
      testId="review-page"
    >
      <ListState {...list} emptyKey="community.flows.review.empty" />
      {list.items?.map((m) => {
        const why = queueReasonKey(m);
        return (
          <article className="card post" key={m.id} data-testid="review-item" data-post-id={m.id}>
            <div className="ph">
              <div className="who">
                <b>{m.authorName}</b>
                <div className="meta">
                  <span className={`pill ${m.type}`}>{t(`community.postType.${m.type}`)}</span>{" "}
                  <span className={m.awaitingReview ? "tag soon sm" : "tag grey sm"}>
                    {t(
                      m.awaitingReview
                        ? "community.flows.review.needsYou"
                        : "community.flows.review.checkingTag",
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="pbody">
              <h3>{m.title}</h3>
              <p className="muted">{t(why.key, why.params)}</p>
            </div>
            {m.awaitingReview && (
              <div className="cbar">
                <div className="sp" />
                <button
                  type="button"
                  className="ghost"
                  data-testid="review-reject"
                  onClick={() => setRejecting(m)}
                >
                  {t("community.flows.review.reject")}
                </button>
                <button
                  type="button"
                  className="primary sm"
                  data-testid="review-approve"
                  onClick={() => void decide(m, "approve")}
                >
                  {t("community.flows.review.approve")}
                </button>
              </div>
            )}
          </article>
        );
      })}
      {rejecting && (
        <ReasonDialog
          testId="review-reject-dialog"
          title={t("community.flows.review.rejectTitle")}
          intro={t("community.flows.review.rejectIntro")}
          label={t("community.flows.review.reasonLabel")}
          required
          submitLabel={t("community.flows.review.reject")}
          onClose={() => setRejecting(null)}
          onSubmit={(text) => decide(rejecting, "reject", text)}
        />
      )}
    </FlowPage>
  );
}
