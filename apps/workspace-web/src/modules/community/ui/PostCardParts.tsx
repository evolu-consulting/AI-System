// Phần tách của thẻ bài (`PostCard.tsx` ≤ 200 dòng): dòng meta dưới tên người đăng, gợi ý SHT, «Đã lưu báo giá».
import type { PostView, QuoteMark } from "@ai/contracts/community";
import { isPartnerPost, sourceKey } from "../domain/feed-source";
import { expiryNote, timeAgo } from "../domain/format";
import { hintLines, savedText } from "../domain/quote";
import { scopeLabel } from "../domain/scope-label";
import { t } from "../i18n";
import { IconBox, IconCheck, IconLock } from "./icons";

/** Công ty · nguồn · thời gian · phạm vi · nhãn trạng thái. */
export function PostMeta({ p }: { p: PostView }) {
  const partner = isPartnerPost(p);
  const scope = partner ? null : scopeLabel(p);
  const expiry = expiryNote(p.expiresAt);
  return (
    <div className="meta">
      <span data-testid="post-company">{p.authorOrgName}</span>
      <span
        className={`tag sm ${partner ? "soon" : "grey"}`}
        data-testid="post-source"
        data-source={sourceKey(p)}
      >
        {t(`community.feed.source.${sourceKey(p)}`)}
      </span>{" "}
      · {timeAgo(p.createdAt)}
      {scope && (
        <>
          {" · "}
          <IconLock size={12} />
          {scope}
        </>
      )}
      {p.edited && <span className="tag grey sm">{t("community.post.edited")}</span>}
      {p.status === "archived" && (
        <span className="tag grey sm">{t("community.post.archived")}</span>
      )}
      {p.status === "done" && <span className="tag ok sm">{t("community.post.done")}</span>}
      {p.status === "expired" && <span className="tag late sm">{t("community.post.expired")}</span>}
      {p.hidden && <span className="tag late sm">{t("community.post.hidden")}</span>}
      {p.authorLeft && <span className="tag grey sm">{t("community.post.partnerLeft")}</span>}
      {expiry && <span className="tag soon sm">{expiry}</span>}
    </div>
  );
}

/** Gợi ý từ Sổ Hợp Tác (chỉ chủ quản). */
export function HostHintNote({ p }: { p: PostView }) {
  if (!p.hostHint) return null;
  return (
    <div className="callout hint" data-testid="host-hint">
      <span className="ci">
        <IconBox />
      </span>
      <span className="ct">
        <b>{hintLines(p.hostHint, p.type).lead}</b> {hintLines(p.hostHint, p.type).text}
      </span>
    </div>
  );
}

/** «Đã lưu báo giá» theo từng dòng hàng (chỉ chủ quản). */
export function SavedQuotes({ p }: { p: PostView }) {
  return (
    <>
      {p.quotes?.map((m: QuoteMark) => (
        <div
          key={`${m.itemIdx}-${m.commentId ?? ""}`}
          className="callout saved"
          data-testid="quote-saved"
        >
          <span className="ci">
            <IconCheck size={18} />
          </span>
          <span className="ct">
            <b>{t("community.post.quoteSaved")}</b> {savedText(m)}
            {m.priceEdited && t("community.post.quotePriceEdited")}
            {!m.priceEdited && m.postEdited && t("community.post.quotePostEdited")}
            {m.commentDeleted && t("community.post.quoteCommentDeleted")}
          </span>
        </div>
      ))}
    </>
  );
}
