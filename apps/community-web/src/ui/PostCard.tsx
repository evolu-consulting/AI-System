// Thẻ bài (mockup `.post`): ⋯ menu (Sửa / Lưu trữ / Đã xong / Xoá + xác nhận đỏ), nhãn đã sửa / lưu trữ / ẩn, bình luận theo luồng.
import { POST_TYPE_LABEL, type PostAction, type PostView } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { draftFromFields } from "../lib/compose";
import { expiryNote, factRows, initials, timeAgo, tone } from "../lib/format";
import { hintLines, saveButtonLabel, savedText } from "../lib/quote";
import { useApp } from "./ctx";
import { DraftFields } from "./DraftFields";
import { Highlighted } from "./Highlighted";
import {
  IconArchive,
  IconBox,
  IconChat,
  IconCheck,
  IconDots,
  IconEdit,
  IconEyeOff,
  IconImage,
  IconLock,
  IconPlay,
  IconSave,
  IconTrash,
} from "./icons";
import { QuoteForm } from "./QuoteForm";
import { Thread } from "./Thread";

const has = (p: PostView, a: PostAction) => p.actions.includes(a);

function PostMenu({
  p,
  onEdit,
  onAsk,
  onDo,
}: {
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
          Sửa bài
        </button>
      )}
      {has(p, "archive") && (
        <button type="button" role="menuitem" onClick={() => onDo("archive")}>
          <IconArchive size={16} />
          Lưu trữ
        </button>
      )}
      {has(p, "unarchive") && (
        <button type="button" role="menuitem" onClick={() => onDo("unarchive")}>
          <IconArchive size={16} />
          Bỏ lưu trữ
        </button>
      )}
      {has(p, "done") && (
        <button type="button" role="menuitem" onClick={() => onDo("done")}>
          <IconCheck size={16} />
          {p.type === "buy" ? "Đã có hàng" : "Đã bán hết"}
        </button>
      )}
      {has(p, "hide") && (
        <button type="button" role="menuitem" onClick={() => onDo("hide")}>
          <IconEyeOff size={16} />
          Ẩn bài
        </button>
      )}
      {has(p, "unhide") && (
        <button type="button" role="menuitem" onClick={() => onDo("unhide")}>
          <IconEyeOff size={16} />
          Bỏ ẩn
        </button>
      )}
      {has(p, "delete") && (
        <button type="button" role="menuitem" className="red" onClick={onAsk}>
          <IconTrash size={16} />
          Xoá bài
        </button>
      )}
    </div>
  );
}

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
    toast("Đã lưu thay đổi");
    bump();
    onClose();
  };
  return (
    <div className="pbody composer">
      <textarea
        aria-label="Sửa nội dung"
        value={d.body}
        onChange={(e) => setD({ ...d, body: e.target.value })}
      />
      {p.type !== "note" && <DraftFields draft={d} set={setD} errors={{}} />}
      <div className="cbar">
        <div className="sp" />
        <button type="button" className="ghost" onClick={onClose}>
          Huỷ
        </button>
        <button type="button" className="primary sm" onClick={save}>
          Lưu thay đổi
        </button>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: thẻ bài theo mockup: nhiều nhánh hiển thị có điều kiện, tách thêm sẽ chỉ chuyển prop
export function PostCard({ post: p }: { post: PostView }) {
  const { api, bump, toast, isHostViewer } = useApp();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
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
    toast(a === "delete" ? "Đã xoá bài" : "Đã cập nhật bài");
    bump();
  };
  const facts = factRows(p);
  const hasMenu = p.actions.some((a) => a !== "saveQuote");
  const expiry = expiryNote(p.expiresAt);
  return (
    <article className="card post" data-testid="post" data-post-id={p.id}>
      <div className="ph">
        <span className={`av ${tone(p.authorOrgId, p.authorSide === "host")}`}>
          {initials(p.authorOrgName)}
        </span>
        <div className="who">
          <b>{p.authorOrgName}</b>
          <div className="meta">
            {p.authorName} · {timeAgo(p.createdAt)} · <IconLock size={12} />
            {p.authorSide === "host" ? "Bạn bè" : "Chỉ chủ quản"}
            {p.edited && <span className="tag grey sm">đã sửa</span>}
            {p.status === "archived" && <span className="tag grey sm">Đã lưu trữ</span>}
            {p.status === "done" && <span className="tag ok sm">Đã xong</span>}
            {p.status === "expired" && <span className="tag late sm">Hết hạn</span>}
            {p.hidden && <span className="tag late sm">đã ẩn</span>}
            {p.authorLeft && <span className="tag grey sm">đối tác đã rời</span>}
            {expiry && <span className="tag soon sm">{expiry}</span>}
          </div>
        </div>
        <span className={`tag ${p.type === "buy" ? "buy" : p.type === "sell" ? "sell" : "grey"}`}>
          {POST_TYPE_LABEL[p.type]}
        </span>
        {has(p, "saveQuote") && p.type === "sell" && (
          <button
            type="button"
            className="outline"
            onClick={() => openQuote(p.authorOrgName)}
            style={{ marginTop: -6 }}
          >
            <IconSave size={16} />
            {saveButtonLabel(savedCount)}
          </button>
        )}
        {hasMenu && (
          <button
            type="button"
            className="iconbtn"
            aria-label="Tuỳ chọn bài đăng"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
            style={{ width: 40, height: 40, marginTop: -6 }}
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
        />
      )}
      {confirm && (
        <div className="confirm" role="alertdialog">
          <span>Xoá vĩnh viễn bài đăng này? Bình luận cũng sẽ bị xoá.</span>
          <span className="sp" />
          <button type="button" className="ghost" onClick={() => setConfirm(false)}>
            Huỷ
          </button>
          <button type="button" className="danger" onClick={() => act("delete")}>
            Xoá
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
      {facts.length > 0 && (
        <div className="facts">
          {facts.map((f) => (
            <div className="fact" key={f.k}>
              <span>{f.k}</span>
              <b>{f.v}</b>
            </div>
          ))}
        </div>
      )}
      {p.media.length > 0 && (
        <div className={`media n${Math.min(p.media.length, 3)}`}>
          {p.media.map((m) => (
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
          ))}
        </div>
      )}
      {isHostViewer && p.hostHint && (
        <div className="match" data-testid="host-hint">
          <IconBox />
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{hintLines(p.hostHint, p.type).lead}</b> {hintLines(p.hostHint, p.type).text}
          </span>
        </div>
      )}
      {isHostViewer &&
        p.quotes?.map((m) => (
          <div
            key={`${m.itemIdx}-${m.commentId ?? ""}`}
            className="match"
            data-testid="quote-saved"
            style={{ background: "#e3f4ec", borderColor: "#bfe5d2", color: "#05603f" }}
          >
            <IconCheck size={18} />
            <span style={{ flex: 1, minWidth: 200 }}>
              <b>Đã lưu báo giá vào Sản phẩm &amp; Giá:</b> {savedText(m)}
              {m.priceEdited && " · NCC đã sửa giá sau khi lưu — lưu lại để cập nhật"}
              {!m.priceEdited && m.postEdited && " · bài đã sửa sau khi lưu"}
              {m.commentDeleted && " · bình luận đã xoá"}
            </span>
          </div>
        ))}
      {quote && (
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
          Bình luận ({p.commentCount})
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
