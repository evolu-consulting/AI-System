// Một bình luận trong luồng (C6): sửa/xoá của người viết, ẩn của chủ quản. `action` = chỗ gắn nút của lát khác (C7b "Lưu báo giá").

import type { CommentView } from "@ai/contracts/community";
import { Input } from "@ai/web-kit/ui/kit/input";
import { type ReactNode, useState } from "react";
import { initials, timeAgo, tone } from "../domain/format";
import { type CommentActions, splitMentions } from "../domain/thread";
import { t } from "../i18n";
import { Highlighted } from "./Highlighted";
import { IconAction } from "./IconAction";
import { IconEdit, IconEyeOff, IconTrash } from "./icons";
import { MentionedLine } from "./MentionedLine";

export type CommentItemProps = {
  comment: CommentView;
  actions: CommentActions;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onHide: (hidden: boolean) => Promise<void>;
  /** Slot cho nút hành động bổ sung (vd Lưu báo giá). */
  action?: ReactNode;
};

export function CommentItem({
  comment: c,
  actions,
  onEdit,
  onDelete,
  onHide,
  action,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  // CR-186: tô đậm «@Tên» của cả công ty (CR-129, chỉ đọc) lẫn NGƯỜI được nhắc
  const tagged = [...c.mentions, ...(c.mentionedUsers ?? [])];
  const save = async () => {
    if (draft.trim()) await onEdit(draft);
    setEditing(false);
  };
  return (
    <div
      className={c.hidden ? "cmt hiddencmt" : "cmt"}
      data-testid="comment"
      data-comment-id={c.id}
    >
      <span className={`av sm ${tone(c.authorOrgId, c.authorSide === "host")}`}>
        {initials(c.authorOrgName)}
      </span>
      <div>
        <div className="bubble">
          <b>
            {c.authorOrgName} · {c.authorName}
          </b>
          {editing ? (
            <Input
              aria-label={t("community.comment.edit")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" ? save() : e.key === "Escape" && setEditing(false)
              }
            />
          ) : (
            <p>
              {tagged.length > 0 && !c.hits?.length ? (
                splitMentions(c.text, tagged).map((part, i) =>
                  part.mention ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: đoạn tách từ chữ tĩnh, thứ tự cố định
                    <b key={i} className="mention" data-testid="mention-tag">
                      {part.text}
                    </b>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: như trên
                    <span key={i}>{part.text}</span>
                  ),
                )
              ) : (
                <Highlighted text={c.text} hits={c.hits} field="body" />
              )}
            </p>
          )}
          <MentionedLine users={c.mentionedUsers} testId="comment-mentions" />
        </div>
        <div className="ctime">
          {timeAgo(c.createdAt)}
          {c.hidden ? t("community.comment.hiddenTag") : ""}
          <span className="acts" data-testid="comment-acts">
            {actions.edit && !editing && (
              <IconAction label={t("community.comment.edit")} onClick={() => setEditing(true)}>
                <IconEdit size={16} />
              </IconAction>
            )}
            {actions.delete && (
              <IconAction label={t("community.comment.delete")} onClick={onDelete}>
                <IconTrash size={16} />
              </IconAction>
            )}
            {actions.hide && (
              <IconAction
                label={c.hidden ? t("community.comment.show") : t("community.comment.hide")}
                onClick={() => onHide(!c.hidden)}
              >
                <IconEyeOff size={16} />
              </IconAction>
            )}
          </span>
          {action}
        </div>
      </div>
    </div>
  );
}
