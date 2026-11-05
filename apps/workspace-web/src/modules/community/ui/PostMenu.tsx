// CR-120 · menu ⋯ của thẻ bài (tách khỏi PostCard cho gọn): Sửa / Lưu trữ / Đã xong / Ẩn / Báo cáo / Xoá theo quyền của bài.
import type { PostAction, PostView } from "@ai/contracts/community";
import { t } from "../i18n";
import { IconArchive, IconCheck, IconEdit, IconEyeOff, IconFlag, IconTrash } from "./icons";

export const has = (p: PostView, a: PostAction) => p.actions.includes(a);

export function PostMenu({
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
    <div className="menu" role="menu">
      {has(p, "edit") && (
        <button type="button" role="menuitem" onClick={onEdit}>
          <IconEdit size={16} />
          {t("community.post.menu.edit")}
        </button>
      )}
      {has(p, "archive") && (
        <button type="button" role="menuitem" onClick={() => onDo("archive")}>
          <IconArchive size={16} />
          {t("community.post.menu.archive")}
        </button>
      )}
      {has(p, "unarchive") && (
        <button type="button" role="menuitem" onClick={() => onDo("unarchive")}>
          <IconArchive size={16} />
          {t("community.post.menu.unarchive")}
        </button>
      )}
      {has(p, "done") && (
        <button type="button" role="menuitem" onClick={() => onDo("done")}>
          <IconCheck size={16} />
          {p.type === "buy" ? t("community.post.menu.doneBuy") : t("community.post.menu.doneSell")}
        </button>
      )}
      {has(p, "hide") && (
        <button type="button" role="menuitem" onClick={() => onDo("hide")}>
          <IconEyeOff size={16} />
          {t("community.post.menu.hide")}
        </button>
      )}
      {has(p, "unhide") && (
        <button type="button" role="menuitem" onClick={() => onDo("unhide")}>
          <IconEyeOff size={16} />
          {t("community.post.menu.unhide")}
        </button>
      )}
      {onReport && (
        <button type="button" role="menuitem" data-testid="post-report" onClick={onReport}>
          <IconFlag size={16} />
          {t("community.flows.reports.menu")}
        </button>
      )}
      {has(p, "delete") && (
        <button type="button" role="menuitem" className="red" onClick={onAsk}>
          <IconTrash size={16} />
          {t("community.post.menu.delete")}
        </button>
      )}
    </div>
  );
}
