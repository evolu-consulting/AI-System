// Bình luận dưới bài (CR-129): MỘT danh sách phẳng (chủ quản thấy hết; đối tác thấy phần server cho phép), không còn luồng riêng theo công ty.
// Gõ `@` nhắc tên công ty đối tác (chỉ chủ quản có gợi ý); gửi kèm `mentions` (id công ty).
import type { CommentView, Mention, PostView } from "@ai/contracts/community";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { initials } from "../domain/format";
import { focusCommentId } from "../domain/search-hint";
import { commentActions, mentionIds } from "../domain/thread";
import { t } from "../i18n";
import { CommentItem } from "./CommentItem";
import { IconLock, IconSend } from "./icons";
import { MentionBox } from "./MentionBox";

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/** `extra`: nút việc gắn thêm trên từng bình luận (vd Lưu báo giá của NCC, C7b) — vào slot `action` của CommentItem. */
export function Thread({
  post,
  onChanged,
  extra,
}: {
  post: PostView;
  onChanged: () => void;
  extra?: (c: CommentView) => ReactNode;
}) {
  const { api, viewer, isHostViewer, rev, toast } = useApp();
  const [comments, setComments] = useState<CommentView[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mention[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const page = await api.listComments(post.id);
    setComments(page.comments);
    setNext(page.nextCursor);
    setLoaded(true);
  }, [api, post.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi dữ liệu đổi (rev)
  useEffect(() => {
    load().catch(() => undefined);
  }, [rev]);

  // Từ chuông `?post=&comment=`: cuộn tới đúng bình luận khi danh sách đã tải.
  useEffect(() => {
    if (!loaded) return;
    const id = focusCommentId(location.search);
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-comment-id="${id}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.classList.add("focused");
  }, [loaded]);

  const more = async () => {
    if (!next) return;
    const page = await api.listComments(post.id, next);
    setComments((c) => [...c, ...page.comments]);
    setNext(page.nextCursor);
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.addComment(post.id, { text, mentions: mentionIds(text, picked) });
      setText("");
      setPicked([]);
      await load();
      onChanged();
    } catch (e) {
      toast(
        errCode(e) === "MENTION_NOT_ALLOWED"
          ? t("community.thread.mentionNotAllowed")
          : t("community.thread.sendFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  const after = async (p: Promise<unknown>) => {
    await p;
    await load();
    onChanged();
  };
  const ctx = { isHost: isHostViewer, postByHost: post.authorSide === "host" };

  return (
    <div className="cmts" data-testid="thread">
      <div className="cnote">
        <IconLock size={13} />
        {isHostViewer ? t("community.thread.note") : t("community.thread.notePartner")}
      </div>
      {loaded && comments.length === 0 && (
        <div className="cnote" data-testid="thread-empty">
          {t("community.thread.empty")}
        </div>
      )}
      {comments.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          action={extra?.(c)}
          actions={commentActions(c, ctx)}
          onEdit={(txt) => after(api.editComment(post.id, c.id, txt))}
          onDelete={() => after(api.deleteComment(post.id, c.id))}
          onHide={(h) => after(api.hideComment(post.id, c.id, h))}
        />
      ))}
      {next && (
        <button type="button" className="clink" data-testid="comments-more" onClick={more}>
          {t("community.thread.more")}
        </button>
      )}
      <div className="cinput">
        <span className="av sm t1">{initials(viewer.orgName)}</span>
        <MentionBox
          text={text}
          onText={setText}
          picked={picked}
          onPick={(m) => setPicked((l) => (l.some((x) => x.orgId === m.orgId) ? l : [...l, m]))}
          fetchOptions={(q) => api.listMentionables(post.id, q)}
          onSubmit={send}
        />
        <button
          type="button"
          className="sendbtn"
          onClick={send}
          disabled={busy}
          aria-label={t("community.thread.send")}
        >
          <IconSend size={16} />
        </button>
      </div>
    </div>
  );
}
