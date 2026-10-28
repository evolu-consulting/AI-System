// Một bình luận trong luồng (C6): sửa/xoá của người viết, ẩn của chủ quản. `action` = chỗ gắn nút của lát khác (C7b "Lưu báo giá").
import type { CommentView } from "@ai/contracts/community";
import { type ReactNode, useState } from "react";
import { initials, timeAgo, tone } from "../lib/format";
import type { CommentActions } from "../lib/thread";
import { Highlighted } from "./Highlighted";
import { IconEdit, IconEyeOff, IconTrash } from "./icons";

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
  const save = async () => {
    if (draft.trim()) await onEdit(draft);
    setEditing(false);
  };
  return (
    <div className={c.hidden ? "cmt hiddencmt" : "cmt"} data-testid="comment">
      <span className={`av sm ${tone(c.authorOrgId, c.authorSide === "host")}`}>
        {initials(c.authorOrgName)}
      </span>
      <div>
        <div className="bubble">
          <b>
            {c.authorOrgName} · {c.authorName}
          </b>
          {editing ? (
            <input
              aria-label="Sửa bình luận"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" ? save() : e.key === "Escape" && setEditing(false)
              }
            />
          ) : (
            <p>
              <Highlighted text={c.text} hits={c.hits} field="body" />
            </p>
          )}
        </div>
        <div className="ctime">
          {timeAgo(c.createdAt)}
          {c.hidden ? " · đã ẩn" : ""}
          {actions.edit && !editing && (
            <button
              type="button"
              className="clink"
              aria-label="Sửa bình luận"
              onClick={() => setEditing(true)}
            >
              <IconEdit size={12} /> Sửa
            </button>
          )}
          {actions.delete && (
            <button type="button" className="clink" aria-label="Xoá bình luận" onClick={onDelete}>
              <IconTrash size={12} /> Xoá
            </button>
          )}
          {actions.hide && (
            <button
              type="button"
              className="clink"
              aria-label={c.hidden ? "Hiện bình luận" : "Ẩn bình luận"}
              onClick={() => onHide(!c.hidden)}
            >
              <IconEyeOff size={12} /> {c.hidden ? "Hiện" : "Ẩn"}
            </button>
          )}
          {action}
        </div>
      </div>
    </div>
  );
}
