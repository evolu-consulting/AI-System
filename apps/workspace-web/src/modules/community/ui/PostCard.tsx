// Thẻ bài (mockup `.post`): ⋯ menu (Sửa / Lưu trữ / Đã xong / Xoá + xác nhận đỏ), nhãn đã sửa / lưu trữ / ẩn, bình luận theo luồng.

import type { MediaItem, ModerationItem, PostView } from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { useEffect, useState } from "react";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { useApp } from "../application/ctx";
import { draftFromFields } from "../domain/compose";
import { canReportPost, isPartnerPost } from "../domain/feed-source";
import { dealStrip, expiryNote } from "../domain/format";
import { saveButtonLabel } from "../domain/quote";
import { opensCommentThread, opensThreadByDefault } from "../domain/search-hint";
import { t } from "../i18n";
import { AttachEditor } from "./AttachEditor";
import { DraftFields } from "./DraftFields";
import { ModerationNote, ReportDialog } from "./flows/PostFlows";
import { Highlighted } from "./Highlighted";
import { IconChat, IconSave } from "./icons";
import { MentionedLine } from "./MentionedLine";
import { has, PostActions } from "./PostActions";
import { HostHintNote, PostMeta, SavedQuotes } from "./PostCardParts";
import { PostMedia } from "./PostMedia";
import { QuoteForm } from "./QuoteForm";
import { Thread } from "./Thread";

/** Mục media giữ lại khi sửa: tệp tải lên ⇒ chỉ cần `fileId` (server điền lại, bỏ `url`); mục ngoài (url) giữ nguyên. */
const keepRef = (m: MediaItem): MediaItem =>
  m.fileId ? { id: m.id, kind: m.kind, label: m.label, fileId: m.fileId } : m;

function EditForm({ p, onClose }: { p: PostView; onClose: () => void }) {
  const { api, bump, toast } = useApp();
  const [d, setD] = useState(() => draftFromFields(p.type, p.body, p.fields, p.cats));
  // CR-147: tệp đính kèm — chỉ gửi `media` khi người dùng đổi (giữ nguyên ⇒ không mở lại lượt duyệt); server thay TOÀN BỘ danh sách.
  const [media, setMedia] = useState<MediaItem[]>(() => p.media.map(keepRef));
  const [mediaDirty, setMediaDirty] = useState(false);
  // HT-52: đối tác chỉ nhận bản đã che; người đăng sửa trên bản gốc (raw) — không có (không phải người đăng) ⇒ giữ bản đang xem.
  useEffect(() => {
    let live = true;
    api.getPostSource(p.id).then(
      (s) => live && setD(draftFromFields(p.type, s.body, s.fields, p.cats)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, p.id, p.type, p.cats]);
  const save = async () => {
    const fields: Record<string, string | null> =
      p.type === "note" ? {} : { product: d.product, qty: d.qty, area: d.area };
    if (p.type === "sell") fields.price = d.price.trim() === "" ? null : d.price;
    if (p.type === "buy") Object.assign(fields, { neededBy: d.neededBy, budget: d.budget });
    await api.updatePost(p.id, {
      body: d.body,
      fields,
      ...(p.type !== "note" ? { title: d.product } : {}),
      ...(mediaDirty ? { media } : {}),
    });
    toast(t("community.post.saved"));
    bump();
    onClose();
  };
  return (
    <div className="pbody composer">
      <textarea
        aria-label={t("community.post.editBodyLabel")}
        value={d.body}
        onChange={(e) => setD({ ...d, body: e.target.value })}
      />
      {p.type !== "note" && <DraftFields draft={d} set={setD} errors={{}} />}
      <AttachEditor
        media={media}
        onChange={(m) => {
          setMedia(m);
          setMediaDirty(true);
        }}
      />
      <div className="cbar">
        <div className="sp" />
        <Button variant="quiet" onClick={onClose}>
          {t("community.common.cancel")}
        </Button>
        <Button variant="primary" size="sm" onClick={save}>
          {t("community.post.saveChanges")}
        </Button>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: thẻ bài theo mockup: nhiều nhánh hiển thị có điều kiện, tách thêm sẽ chỉ chuyển prop
export function PostCard({
  post: p,
  mod,
  avatar,
}: {
  post: PostView;
  mod?: ModerationItem | undefined;
  /** Ảnh đại diện thật của người đăng (thẻ người); vắng ⇒ chữ cái đầu. */
  avatar?: string | null | undefined;
}) {
  const { api, bump, toast, isHostViewer, viewer, urlSearch, dropPost } = useApp();
  const [reporting, setReporting] = useState(false);
  const canReport = canReportPost(p, viewer.orgId);
  const download = (id: string, name: string) =>
    api.downloadFile(id, name).catch(() => toast(t("community.post.downloadFailed")));
  const [editing, setEditing] = useState(false);
  // Mở sẵn bình luận khi vào từ chuông `?post=<id>&comment=<id>` (CR-129).
  const fromBell = opensCommentThread(urlSearch, p.id);
  // CR-186: bài có bình luận ⇒ hiện sẵn 3 bình luận mới nhất (không phải bấm «Bình luận»).
  const [open, setOpen] = useState(opensThreadByDefault(urlSearch, p.id, p.commentCount));
  // Bấm thông báo khi đã ở Bảng tin (điều hướng trong app, thẻ bài không dựng lại) ⇒ mở bình luận khi ?comment đổi.
  useEffect(() => {
    if (fromBell) setOpen(true);
  }, [fromBell]);
  const [quote, setQuote] = useState<{ supplier: string; commentId?: string; idx: number } | null>(
    null,
  );
  const savedCount = p.quotes?.length ?? 0;
  const openQuote = (supplier: string, commentId?: string) =>
    setQuote({ supplier, ...(commentId ? { commentId } : {}), idx: 0 });
  const act = async (a: "archive" | "unarchive" | "done" | "hide" | "unhide" | "delete") => {
    if (a === "delete") {
      // Xoá lạc quan: bài mất ngay; lỗi ⇒ khôi phục + báo.
      dropPost(p.id, true);
      try {
        await api.postAction(p.id, { action: a });
      } catch {
        dropPost(p.id, false);
        toast(t("community.post.deleteFailed"));
        return;
      }
      toast(t("community.post.deleted"));
      bump();
      return;
    }
    await api.postAction(p.id, { action: a });
    toast(t("community.post.updated"));
    bump();
  };
  const askDelete = async () => {
    const ok = await confirmDialog({
      title: t("community.post.deleteTitle"),
      body: t("community.post.confirmDelete"),
      confirmLabel: t("community.common.delete"),
      cancelLabel: t("community.common.cancel"),
      danger: true,
    });
    if (ok) await act("delete");
  };
  const deal = dealStrip(p);
  const muted = p.status === "archived" || p.status === "done" || p.status === "expired";
  const hasMenu = canReport || p.actions.some((a) => a !== "saveQuote");
  const _expiry = expiryNote(p.expiresAt);
  const partner = isPartnerPost(p);
  return (
    <article
      className={`card post ${p.type}${muted ? " muted" : ""}`}
      data-testid="post"
      data-post-id={p.id}
    >
      <div className="ph">
        <PersonAvatar
          name={p.authorName}
          src={avatar}
          id={`${p.authorOrgId}:${p.authorName}`}
          size={40}
          className="av"
        />
        <div className="who">
          <b data-testid="post-author">{p.authorName}</b>
          {p.authorTitle && <span className="atitle"> · {p.authorTitle}</span>}
          <PostMeta p={p} />
        </div>
        <span className={`pill ${p.type}`}>{t(`community.postType.${p.type}`)}</span>
        {isHostViewer && has(p, "saveQuote") && p.type === "sell" && (
          <Button variant="outline" onClick={() => openQuote(p.authorOrgName)}>
            <IconSave size={16} />
            {saveButtonLabel(savedCount)}
          </Button>
        )}
        {hasMenu && (
          <PostActions
            p={p}
            onEdit={() => setEditing(true)}
            onAsk={() => {
              void askDelete();
            }}
            onDo={act}
            onReport={canReport ? () => setReporting(true) : undefined}
          />
        )}
      </div>
      {reporting && <ReportDialog postId={p.id} onClose={() => setReporting(false)} />}
      {mod && <ModerationNote item={mod} />}
      {editing ? (
        <EditForm p={p} onClose={() => setEditing(false)} />
      ) : (
        <div className="pbody">
          {p.title && (
            <h3>
              <Highlighted text={p.title} hits={p.hits} field="title" />
            </h3>
          )}
          {p.body && (
            <p>
              <Highlighted text={p.body} hits={p.hits} field="body" />
            </p>
          )}
          <MentionedLine users={p.mentionedUsers} testId="post-mentions" />
        </div>
      )}
      {deal && (
        <div className={`deal ${p.type}`} data-testid="deal">
          <div className="hero">
            <span className="k">{deal.hero.k}</span>
            <span className="v tnum">{deal.hero.v}</span>
          </div>
          {deal.cells.length > 0 && (
            <div className="rest">
              {deal.cells.map((c) => (
                <div className="cell" key={c.k}>
                  <span className="k">{c.k}</span>
                  <span className="v">{c.v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {p.media.length > 0 && <PostMedia media={p.media} onDownload={download} />}
      {isHostViewer && <HostHintNote p={p} />}
      {isHostViewer && <SavedQuotes p={p} />}
      {isHostViewer && quote && (
        <QuoteForm
          key={`${quote.idx}-${quote.commentId ?? ""}`}
          post={p}
          supplier={quote.supplier}
          itemIdx={quote.idx}
          {...(quote.commentId ? { commentId: quote.commentId } : {})}
          onClose={() => setQuote(null)}
          onSaved={(more) => {
            bump();
            if (more) setQuote({ ...quote, idx: quote.idx + 1 });
            else setQuote(null);
          }}
        />
      )}
      {partner && (p.fileCount ?? 0) > 0 && (
        <div className="pfiles" data-testid="post-files">
          {t("community.feed.files", { n: p.fileCount })}
        </div>
      )}
      <div className="pact">
        <button
          type="button"
          className={open ? "on" : ""}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <IconChat />
          {t("community.post.comments", { n: p.commentCount })}
        </button>
      </div>
      {open && (
        <Thread
          post={p}
          onChanged={bump}
          extra={(c) =>
            isHostViewer &&
            p.type === "buy" &&
            p.authorSide === "host" &&
            c.authorSide === "partner" &&
            !c.fromConnected ? (
              <Button variant="outline" size="sm" onClick={() => openQuote(c.authorOrgName, c.id)}>
                <IconSave size={14} />
                {saveButtonLabel(p.quotes?.filter((m) => m.commentId === c.id).length ?? 0)}
              </Button>
            ) : null
          }
        />
      )}
    </article>
  );
}
