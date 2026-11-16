// Bình luận dưới bài (CR-129): MỘT danh sách phẳng (chủ quản thấy hết; đối tác thấy phần server cho phép), không còn luồng riêng theo công ty.
// Gõ `@` nhắc tên công ty đối tác (chỉ chủ quản có gợi ý); gửi kèm `mentions` (id công ty).

import type { CommentView, Mention, PostView } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { useApp } from "../application/ctx";
import { initials } from "../domain/format";
import { focusCommentId } from "../domain/search-hint";
import { commentActions, mentionIds } from "../domain/thread";
import { t } from "../i18n";
import { CommentItem } from "./CommentItem";
import { IconLock, IconSend } from "./icons";
import { MentionBox } from "./MentionBox";

/** Số bình luận cũ hơn tải mỗi lần bấm «Xem thêm»; số trang tối đa tự tải để tới bình luận từ chuông. */
const PAGE = 10;
const FOCUS_PAGES = 5;
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
  const { api, viewer, isHostViewer, toast, urlSearch } = useApp();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mention[]>([]);
  const [busy, setBusy] = useState(false);
  // CR-147c: trang bảng tin đã trả 2 bình luận mới nhất + tổng số (`post.recentComments` / `commentCount`). «Xem thêm» tải tiếp
  // phần CŨ HƠN theo trang (cursor) vào `older`; không nạp hết khi mở bài.
  const [older, setOlder] = useState<CommentView[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [next, setNext] = useState<string | undefined>();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [patched, setPatched] = useState<ReadonlyMap<string, CommentView>>(new Map());
  const recent = post.recentComments;
  const all = useMemo(() => {
    const m = new Map<string, CommentView>();
    for (const c of [...older, ...recent]) m.set(c.id, patched.get(c.id) ?? c);
    for (const id of gone) m.delete(id);
    return [...m.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  }, [older, recent, gone, patched]);
  const canMore = expanded ? next !== undefined : post.commentCount > recent.length;
  const hiddenCount = Math.max(0, post.commentCount - gone.size - all.length);
  const [loadingMore, setLoadingMore] = useState(false);

  const more = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const oldest = all[0];
      const page = expanded
        ? await api.listComments(post.id, next, { dir: "desc", limit: PAGE })
        : await api.listComments(post.id, undefined, {
            dir: "desc",
            limit: PAGE,
            ...(oldest ? { before: oldest.id } : {}),
          });
      setOlder((o) => [...o, ...page.comments]);
      setNext(page.nextCursor);
      setExpanded(true);
    } finally {
      setLoadingMore(false);
    }
  }, [api, post.id, next, expanded, all, loadingMore]);

  // Từ chuông `?post=&comment=`: cuộn tới đúng bình luận; chưa tải tới ⇒ tải dần trang cũ hơn (tối đa `FOCUS_PAGES` trang).
  const tries = useRef(0);
  useEffect(() => {
    const id = focusCommentId(urlSearch);
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-comment-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("focused");
    } else if (canMore && tries.current < FOCUS_PAGES) {
      tries.current += 1;
      more().catch(() => undefined);
    }
  }, [urlSearch, canMore, more]);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.addComment(post.id, { text, mentions: mentionIds(text, picked) });
      setText("");
      setPicked([]);
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
  const after = async (p: Promise<CommentView | undefined | void>, removedId?: string) => {
    const v = await p;
    if (removedId) setGone((g) => new Set(g).add(removedId));
    else if (v) setPatched((m) => new Map(m).set(v.id, v));
    onChanged();
  };
  const ctx = { isHost: isHostViewer, postByHost: post.authorSide === "host" };

  return (
    <div className="cmts" data-testid="thread">
      <div className="cnote">
        <IconLock size={13} />
        {isHostViewer ? t("community.thread.note") : t("community.thread.notePartner")}
      </div>
      {post.commentCount === 0 && (
        <div className="cnote" data-testid="thread-empty">
          {t("community.thread.empty")}
        </div>
      )}
      {canMore && (
        <Button
          variant="link"
          data-testid="comments-more"
          disabled={loadingMore}
          onClick={() => more().catch(() => undefined)}
        >
          {t("community.thread.more", { count: Math.max(1, hiddenCount) })}
        </Button>
      )}
      {all.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          action={extra?.(c)}
          actions={commentActions(c, ctx)}
          onEdit={(txt) => after(api.editComment(post.id, c.id, txt))}
          onDelete={async () => {
            const ok = await confirmDialog({
              title: t("community.comment.deleteTitle"),
              body: t("community.comment.confirmDelete"),
              confirmLabel: t("community.common.delete"),
              cancelLabel: t("community.common.cancel"),
              danger: true,
            });
            if (!ok) return;
            try {
              await after(api.deleteComment(post.id, c.id), c.id);
            } catch {
              toast(t("community.comment.deleteFailed"));
            }
          }}
          onHide={(h) => after(api.hideComment(post.id, c.id, h))}
        />
      ))}
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
