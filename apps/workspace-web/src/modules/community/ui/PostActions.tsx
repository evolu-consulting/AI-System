// CR-191 BR-187-6 · icon thao tác của thẻ bài (thay menu ⋯ có chữ): Sửa / Lưu trữ / Đã xong / Ẩn / Báo cáo / Xoá theo quyền của bài.
// Nút nhỏ sát nhau (28px cách 2px; điện thoại 44px) — xem `.ph .acts` trong feed.css / mobile.css.
import type { PostAction, PostView } from "@ai/contracts/community";
import { t } from "../i18n";
import { IconAction } from "./IconAction";
import { IconArchive, IconCheck, IconEdit, IconEyeOff, IconFlag, IconTrash } from "./icons";

export const has = (p: PostView, a: PostAction) => p.actions.includes(a);

export function PostActions({
  p,
  onEdit,
  onAsk,
  onDo,
  onReport,
}: {
  onReport?: (() => void) | undefined;
  p: PostView;
  onEdit: () => void;
  onAsk: () => void;
  onDo: (a: "archive" | "unarchive" | "done" | "hide" | "unhide") => void;
}) {
  return (
    <span className="acts" data-testid="post-acts">
      {has(p, "edit") && (
        <IconAction label={t("community.post.menu.edit")} onClick={onEdit} testId="post-edit">
          <IconEdit size={16} />
        </IconAction>
      )}
      {has(p, "archive") && (
        <IconAction label={t("community.post.menu.archive")} onClick={() => onDo("archive")}>
          <IconArchive size={16} />
        </IconAction>
      )}
      {has(p, "unarchive") && (
        <IconAction label={t("community.post.menu.unarchive")} onClick={() => onDo("unarchive")}>
          <IconArchive size={16} />
        </IconAction>
      )}
      {has(p, "done") && (
        <IconAction
          label={
            p.type === "buy" ? t("community.post.menu.doneBuy") : t("community.post.menu.doneSell")
          }
          onClick={() => onDo("done")}
        >
          <IconCheck size={16} />
        </IconAction>
      )}
      {has(p, "hide") && (
        <IconAction
          label={t("community.post.menu.hide")}
          onClick={() => onDo("hide")}
          testId="post-hide"
        >
          <IconEyeOff size={16} />
        </IconAction>
      )}
      {has(p, "unhide") && (
        <IconAction label={t("community.post.menu.unhide")} onClick={() => onDo("unhide")}>
          <IconEyeOff size={16} />
        </IconAction>
      )}
      {onReport && (
        <IconAction
          label={t("community.flows.reports.menu")}
          onClick={onReport}
          testId="post-report"
        >
          <IconFlag size={16} />
        </IconAction>
      )}
      {has(p, "delete") && (
        <IconAction label={t("community.post.menu.delete")} onClick={onAsk} testId="post-delete">
          <IconTrash size={16} />
        </IconAction>
      )}
    </span>
  );
}
