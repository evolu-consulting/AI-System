// Thẻ bài (mockup `.post`): ⋯ menu (Sửa / Lưu trữ / Đã xong / Xoá + xác nhận đỏ), nhãn đã sửa / lưu trữ / ẩn, bình luận theo luồng.
import type { ModerationItem, PostAction, PostView } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import { draftFromFields } from "../domain/compose";
import { dealStrip, expiryNote, initials, timeAgo, tone } from "../domain/format";
import { formatSize } from "../domain/media";
import { hintLines, saveButtonLabel, savedText } from "../domain/quote";
import { focusCommentId, focusPostId } from "../domain/search-hint";
import { numLocale, t } from "../i18n";
import { DraftFields } from "./DraftFields";
import { ModerationNote, ReportDialog } from "./flows/PostFlows";
import { Highlighted } from "./Highlighted";
import {
  IconArchive,
  IconAttach,
  IconBox,
  IconChat,
  IconCheck,
  IconDots,
  IconEdit,
  IconEyeOff,
  IconFlag,
  IconImage,
  IconLock,
  IconPlay,
  IconSave,
  IconTrash,
} from "./icons";
import { has, PostMenu } from "./PostMenu";
import { QuoteForm } from "./QuoteForm";
import { Thread } from "./Thread";

function EditForm({ p, onClose }: { p: PostView; onClose: () => void }) {
  const { api, bump, toast } = useApp();
  const [d, setD] = useState(() => draftFromFields(p.type, p.body, p.fields, p.cats));
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
      <div className="cbar">
        <div className="sp" />
        <button type="button" className="ghost" onClick={onClose}>
          {t("community.common.cancel")}
        </button>
        <button type="button" className="primary sm" onClick={save}>
          {t("community.post.saveChanges")}
        </button>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: thẻ bài theo mockup: nhiều nhánh hiển thị có điều kiện, tách thêm sẽ chỉ chuyển prop
export function PostCard({ post: p, mod }: { post: PostView; mod?: ModerationItem | undefined }) {
  const { api, bump, toast, isHostViewer, viewer } = useApp();
  const [reporting, setReporting] = useState(false);
  const canReport = p.authorOrgId !== viewer.orgId;
  const download = (id: string, name: string) =>
    api.downloadFile(id, name).catch(() => toast(t("community.post.downloadFailed")));
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  // Mở sẵn bình luận khi vào từ chuông `?post=<id>&comment=<id>` (CR-129).
  const [open, setOpen] = useState(
    () => focusPostId(location.search) === p.id && focusCommentId(location.search) !== null,
  );
  const [quote, setQuote] = useState<{ supplier: string; commentId?: string; idx: number } | null>(
    null,
  );
  const savedCount = p.quotes?.length ?? 0;
  const openQuote = (supplier: string, commentId?: string) =>
    setQuote({ supplier, ...(commentId ? { commentId } : {}), idx: 0 });
  const act = async (a: "archive" | "unarchive" | "done" | "hide" | "unhide" | "delete") => {
    setMenu(false);
    setConfirm(false);
    await api.postAction(p.id, { action: a });
    toast(a === "delete" ? t("community.post.deleted") : t("community.post.updated"));
    bump();
  };
  const deal = dealStrip(p);
  const muted = p.status === "archived" || p.status === "done" || p.status === "expired";
  const hasMenu = canReport || p.actions.some((a) => a !== "saveQuote");
  const expiry = expiryNote(p.expiresAt);
  return (
    <article
      className={`card post ${p.type}${muted ? " muted" : ""}`}
      data-testid="post"
      data-post-id={p.id}
    >
      <div className="ph">
        <span className={`av ${tone(p.authorOrgId, p.authorSide === "host")}`}>
          {initials(p.authorOrgName)}
        </span>
        <div className="who">
          <b>{p.authorOrgName}</b>
          <div className="meta">
            {p.authorName} · {timeAgo(p.createdAt)} · <IconLock size={12} />
            {p.authorSide === "host" ? t("community.post.friends") : t("community.post.hostOnly")}
            {p.edited && <span className="tag grey sm">{t("community.post.edited")}</span>}
            {p.status === "archived" && (
              <span className="tag grey sm">{t("community.post.archived")}</span>
            )}
            {p.status === "done" && <span className="tag ok sm">{t("community.post.done")}</span>}
            {p.status === "expired" && (
              <span className="tag late sm">{t("community.post.expired")}</span>
            )}
            {p.hidden && <span className="tag late sm">{t("community.post.hidden")}</span>}
            {p.authorLeft && <span className="tag grey sm">{t("community.post.partnerLeft")}</span>}
            {expiry && <span className="tag soon sm">{expiry}</span>}
          </div>
        </div>
        <span className={`pill ${p.type}`}>{t(`community.postType.${p.type}`)}</span>
        {isHostViewer && has(p, "saveQuote") && p.type === "sell" && (
          <button type="button" className="outline" onClick={() => openQuote(p.authorOrgName)}>
            <IconSave size={16} />
            {saveButtonLabel(savedCount)}
          </button>
        )}
        {hasMenu && (
          <button
            type="button"
            className="iconbtn"
            aria-label={t("community.post.options")}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <IconDots />
          </button>
        )}
      </div>
      {menu && (
        <PostMenu
          p={p}
          onEdit={() => {
            setMenu(false);
            setEditing(true);
          }}
          onAsk={() => {
            setMenu(false);
            setConfirm(true);
          }}
          onDo={act}
          onReport={
            canReport
              ? () => {
                  setMenu(false);
                  setReporting(true);
                }
              : undefined
          }
        />
      )}
      {reporting && <ReportDialog postId={p.id} onClose={() => setReporting(false)} />}
      {mod && <ModerationNote item={mod} />}
      {confirm && (
        <div className="confirm" role="alertdialog">
          <span>{t("community.post.confirmDelete")}</span>
          <span className="sp" />
          <button type="button" className="ghost" onClick={() => setConfirm(false)}>
            {t("community.common.cancel")}
          </button>
          <button type="button" className="danger" onClick={() => act("delete")}>
            {t("community.common.delete")}
          </button>
        </div>
      )}
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
      {p.media.length > 0 && (
        <div className={`media n${Math.min(p.media.length, 3)}`}>
          {p.media.map((m) =>
            m.kind === "file" && m.fileId ? (
              <button
                key={m.id}
                type="button"
                className="mbox filecard"
                data-testid="file-card"
                title={t("community.post.download")}
                onClick={() => void download(m.fileId as string, m.name ?? m.label)}
              >
                <IconAttach size={22} />
                <span className="fname">{m.name ?? m.label}</span>
                {m.size !== undefined && <i className="fsize">{formatSize(m.size, numLocale())}</i>}
                <b className="fget">{t("community.post.download")}</b>
              </button>
            ) : (
              <div key={m.id} className={m.kind === "video" ? "mbox vid" : "mbox"}>
                {m.kind === "video" ? (
                  <span className="play">
                    <IconPlay />
                  </span>
                ) : (
                  <IconImage size={26} />
                )}
                <span>{m.label}</span>
              </div>
            ),
          )}
        </div>
      )}
      {isHostViewer && p.hostHint && (
        <div className="callout hint" data-testid="host-hint">
          <span className="ci">
            <IconBox />
          </span>
          <span className="ct">
            <b>{hintLines(p.hostHint, p.type).lead}</b> {hintLines(p.hostHint, p.type).text}
          </span>
        </div>
      )}
      {isHostViewer &&
        p.quotes?.map((m) => (
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
            c.authorSide === "partner" ? (
              <button
                type="button"
                className="outline sm"
                onClick={() => openQuote(c.authorOrgName, c.id)}
              >
                <IconSave size={14} />
                {saveButtonLabel(p.quotes?.filter((m) => m.commentId === c.id).length ?? 0)}
              </button>
            ) : null
          }
        />
      )}
    </article>
  );
}
