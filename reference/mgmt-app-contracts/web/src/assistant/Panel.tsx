import { Fragment, useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText } from "@/api/client";
import { uploadContract } from "@/api/board";
import { useMe } from "@/api/session";
import { useNavigate } from "react-router";
import { ActionCard, type Card } from "./cards";
import { applyTableFilter, type TableFilterCard } from "@/components/table";
import { IconAttach, IconClose, IconRobot, IconSend } from "@/components/icons";
import { runPrefill, type UiCard } from "./prefill";
import type { PageContext } from "./context";
import { ask, uploadChatFiles, type ChatFile } from "./stream";

type Msg = { role: "user" | "assistant"; text: string; files?: Attach[]; cards?: Card[]; error?: string; pending?: boolean; step?: string };
type Digest = { greeting_name: string | null; intro: string | null; items: Card[]; backend?: "api" | "cli" };
/** A file the person added to the next question: uploading, ready (has id) or failed. */
type Attach = { key: string; name: string; size: number; mime: string; url?: string; id?: string; error?: string };

// **bold**, [text](https://…) and a bare https://… link; only web links, opened in a new tab without the app's context
const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)<]+)/;
const link = (href: string, text: string, key: string) => (
  <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="break-all text-act underline underline-offset-2">{text}</a>
);
const inline = (s: string, k: number) => s.split(INLINE).map((part, j) => {
  const key = `${k}-${j}`;
  if (part.startsWith("**") && part.endsWith("**")) return <b key={key}>{part.slice(2, -2)}</b>;
  const md = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
  if (md) return link(md[2], md[1], key);
  if (/^https?:\/\//.test(part)) return link(part, part, key);
  return <Fragment key={key}>{part}</Fragment>;
});

/** The markdown the answers use: **bold**, links, "- " lists, "### " headings and | tables |. Nothing else, no HTML. */
export function Rich({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {                       // a table: header, separator, rows
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        <div key={i} className="my-1.5 overflow-x-auto">
          {/* the panel is narrow: columns keep a readable width and the table scrolls sideways instead of
              breaking every word onto its own line */}
          <table className="min-w-full text-[12.5px] [&_td]:min-w-[7.5rem] [&_th]:min-w-[7.5rem]">
            <thead><tr>{head?.map((c, j) => <th key={j} className="border-b border-rule px-1.5 py-1 text-left font-semibold">{inline(c, j)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => (
              <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-rule-soft px-1.5 py-1 align-top">{inline(c, j)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>);
    } else if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      const m = l.match(/^(\s*)([-*•]|\d+\.)\s+(.*)$/)!;
      out.push(<p key={i} className={`flex gap-1.5 ${m[1].length ? "pl-4" : ""}`}><span className="text-dim">{/\d/.test(m[2]) ? m[2] : "•"}</span><span>{inline(m[3], i)}</span></p>);
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(<p key={i} className="mt-1 font-semibold">{inline(l.replace(/^#+\s/, ""), i)}</p>);
    } else if (l.trim()) {
      out.push(<p key={i}>{inline(l, i)}</p>);
    } else {
      out.push(<div key={i} className="h-1.5" />);
    }
  }
  return <div className="space-y-0.5">{out}</div>;
}

const digestPage = (page: string) => (page.startsWith("cks") ? "cks" : "main");
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function Chips({ files, onRemove }: { files: Attach[]; onRemove?: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f) => (
        <span key={f.key} className={`flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] ${
          f.error ? "border-late-line bg-late-bg text-late" : "border-rule bg-panel text-ink-2"}`} title={f.error ?? f.name}>
          {f.url ? <img src={f.url} alt="" className="h-7 w-7 rounded object-cover" /> : <span aria-hidden>📎</span>}
          <span className="max-w-[140px] truncate">{f.name}</span>
          <span className="text-dim">{f.error ? "lỗi" : f.id ? kb(f.size) : "đang tải…"}</span>
          {onRemove && <button type="button" aria-label={`Bỏ ${f.name}`} className="text-dim hover:text-late" onClick={() => onRemove(f.key)}>×</button>}
        </span>
      ))}
    </div>
  );
}

/** The conversation lives here, not in the panel: an answer still streaming when the panel closes keeps arriving, and
 *  the panel opened again (or the phone sheet) shows it all. Until the page reloads. */
const kept = new Map<string, unknown>();
const keptSubs = new Set<() => void>();
function useKept<T>(key: string, init: T): [T, (u: T | ((prev: T) => T)) => void] {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { keptSubs.add(rerender); return () => { keptSubs.delete(rerender); }; }, []);
  const set = useCallback((u: T | ((prev: T) => T)) => {
    const prev = (kept.has(key) ? kept.get(key) : init) as T;
    kept.set(key, typeof u === "function" ? (u as (p: T) => T)(prev) : u);
    keptSubs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [(kept.has(key) ? kept.get(key) : init) as T, set];
}

export function AssistantPanel({ ctx, onClose, closeLabel = "Đóng" }: { ctx: PageContext; onClose?: () => void; closeLabel?: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const page = digestPage(ctx.page);
  const digest = useQuery({
    queryKey: ["assistant", "digest", page],
    queryFn: () => api<Digest>(`/assistant/digest${page === "cks" ? "?page=cks" : ""}`),
    staleTime: 30_000,
  });
  // kept outside the panel: closing it, opening Góp ý in its place or closing the phone sheet must not lose the chat
  const [msgs, setMsgs] = useKept<Msg[]>("msgs", []);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attach[]>([]);
  const [chatId, setChatId] = useKept<string | null>("chatId", null);
  const [dragging, setDragging] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // the question box grows with what is typed (up to its max height), and shrinks back once sent
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const busy = msgs.some((m) => m.pending);
  const uploading = files.some((f) => !f.id && !f.error);
  const cli = digest.data?.backend === "cli";

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const patchLast = (f: (a: Msg) => Msg) => setMsgs((m) => [...m.slice(0, -1), f(m[m.length - 1])]);

  /** Files dropped, pasted or picked: uploaded at once, sent with the next question. */
  async function add(list: FileList | File[]) {
    const picked = [...list].slice(0, 10);
    if (!picked.length) return;
    if (!cli) return dropContract(picked[0]);     // without the CLI assistant a dropped file is a contract, as before
    const added: Attach[] = picked.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name || "ảnh-dán.png", size: f.size,
      mime: f.type, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }));
    setFiles((cur) => [...cur, ...added]);
    try {
      const got: ChatFile[] = await uploadChatFiles(picked);
      setFiles((cur) => cur.map((a) => { const i = added.findIndex((x) => x.key === a.key); return i >= 0 ? { ...a, id: got[i]?.id } : a; }));
    } catch (e) {
      const msg = errText(e);
      setFiles((cur) => cur.map((a) => (added.some((x) => x.key === a.key) ? { ...a, error: msg } : a)));
    }
  }

  // a question sent while the last one is still being answered waits for it, then goes with that answer as history
  const [queued, setQueued] = useState<string | null>(null);
  useEffect(() => {
    if (!busy && queued) { const q = queued; setQueued(null); void submit(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queued]);

  async function submit(q: string) {
    const ready = files.filter((f) => f.id);
    if (busy && q.trim() && !queued) { setQueued(q.trim()); setText(""); return; }
    if ((!q.trim() && !ready.length) || busy || uploading) return;
    const question = q.trim() || "Xem và xử lý giúp tôi các file này";
    setText("");
    setFiles([]);
    setMsgs((m) => [...m, { role: "user", text: question, files: ready }, { role: "assistant", text: "", pending: true }]);
    await ask({ question, chatId, ctx, files: ready.map((f) => f.id!) }, {
      step: (s) => patchLast((a) => ({ ...a, step: s })),
      token: (t) => patchLast((a) => ({ ...a, text: a.text + t })),
      cards: (cards) => {
        patchLast((a) => ({ ...a, cards: [...(a.cards ?? []), ...cards] }));
        const form = cards.find((c) => c.type === "ui");           // a form the assistant filled: open it on its page
        if (form) void runPrefill(form as UiCard, nav);
        const filter = cards.find((c) => c.type === "filter");     // a table the assistant filtered: show it filtered
        if (filter) applyTableFilter(filter as unknown as TableFilterCard, nav);
      },
      done: (id, changed) => {
        setChatId(id);
        patchLast((a) => ({ ...a, pending: false }));
        if (changed) void qc.invalidateQueries();      // the assistant changed data: every page reads fresh
      },
      error: (e) => patchLast((a) => ({ ...a, pending: false, error: e })),
    });
  }

  /** API backend: a contract dropped on the panel is uploaded, read, and shown back as a card with Lưu / Sửa. */
  async function dropContract(file: File) {
    if (busy) return;
    setMsgs((m) => [...m, { role: "user", text: `📎 ${file.name}\nLưu giúp mình hợp đồng này` },
      { role: "assistant", text: "", pending: true, step: "Đang đọc hợp đồng" }]);
    try {
      const { id } = await uploadContract(file);
      for (let i = 0; i < 90; i++) {
        const r = await api<{ status: string; card?: Card; error?: string }>(`/assistant/attach/${id}`);
        if (r.card) {
          patchLast((a) => ({ ...a, pending: false, cards: [r.card!] }));
          await qc.invalidateQueries({ queryKey: ["board"] });
          return;
        }
        if (r.status === "failed") return patchLast((a) => ({ ...a, pending: false, error: r.error }));
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      patchLast((a) => ({ ...a, pending: false, error: "Đọc lâu quá, xem lại trong danh sách hợp đồng sau ít phút." }));
    } catch (e) {
      patchLast((a) => ({ ...a, pending: false, error: errText(e) }));
    }
  }

  const items = digest.data?.items ?? [];
  const name = digest.data?.greeting_name ?? me?.name ?? "";

  const suggestions = SUGGEST[ctx.page] ?? SUGGEST.other;
  const canSend = !uploading && (busy ? !!text.trim() && !queued : !!text.trim() || files.some((f) => f.id));

  return (
    <div className={`relative flex h-full flex-col ${dragging ? "outline-2 -outline-offset-4 outline-act outline-dashed" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void add(e.dataTransfer.files); }}>
      <div className="flex h-[58px] shrink-0 items-center gap-2.5 px-4">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-act to-[#a855f7] text-on-act shadow-sm"><IconRobot width={18} height={18} /></span>
        <span className="min-w-0 leading-tight">
          <h2 className="text-[14.5px] font-semibold">Trợ lý AI</h2>
          <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse bg-soon" : "bg-ok"}`} />{busy ? "Đang trả lời…" : "Sẵn sàng"}
          </span>
        </span>
        {onClose && (
          <button type="button" onClick={onClose} title={closeLabel ?? "Đóng"} aria-label={closeLabel ?? "Đóng"}
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink"><IconClose width={17} height={17} /></button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-4" aria-live="polite">
        {(items.length > 0 || digest.data?.intro || msgs.length === 0) && (
          <div className="rounded-2xl border border-rule-soft bg-sunk p-3.5 text-[13.5px]">
            <div className="mb-2">
              {digest.data?.intro ? <Rich text={digest.data.intro} /> : (
                <p>Chào {name || "bạn"} 👋 {items.length ? <>Hôm nay có <b>{items.length} việc</b> cần chú ý:</> : "Hôm nay chưa có việc gì cần chú ý."}</p>
              )}
            </div>
            <div className="space-y-2">{items.map((c, i) => <ActionCard key={c.id ?? i} card={c} />)}</div>
          </div>
        )}
        {msgs.length === 0 && cli && (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-dim">Thử hỏi</p>
            <div className="flex flex-col items-start gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void submit(s)}
                  className="rounded-xl border border-rule bg-panel px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:border-act-line hover:bg-act-soft hover:text-act">
                  {s}
                </button>
              ))}
            </div>
            <p className="pt-1 text-[12px] text-dim">Kéo thả ảnh, hợp đồng, hoá đơn đã ký hay file Excel vào đây.</p>
          </div>
        )}

        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="rise ml-auto w-fit max-w-[88%] min-w-0 space-y-1.5 rounded-2xl rounded-br-md bg-act-soft px-3.5 py-2.5 text-[13.5px] whitespace-pre-line text-ink [overflow-wrap:anywhere]">
            {!!m.files?.length && <Chips files={m.files} />}
            <p>{m.text}</p>
          </div>
        ) : (
          // no bubble: the answer reads as text beside the assistant's mark; overflow-wrap keeps long links inside
          <div key={i} className="rise flex min-w-0 gap-2.5">
            <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-act-soft text-act"><IconRobot width={14} height={14} /></span>
            <div className="min-w-0 flex-1 space-y-2 text-[13.5px] leading-relaxed [overflow-wrap:anywhere]">
              {m.text ? <Rich text={m.text.replace(/\s*\[\d+\]/g, "")} />
                : m.pending && (
                  <p className="flex items-center gap-2 text-dim">
                    <span className="dots text-act"><span /><span /><span /></span>{m.step ? `${m.step}…` : "Đang xem dữ liệu…"}
                  </p>
                )}
              {m.text && m.pending && m.step && <p className="text-[12px] text-dim">{m.step}…</p>}
              {m.cards?.map((c, j) => <ActionCard key={j} card={c} />)}
              {m.error && <p role="alert" className="rounded-lg bg-late-bg px-3 py-2 text-late">{m.error}</p>}
            </div>
          </div>
        ))}
        {queued && (
          <div className="ml-auto w-fit max-w-[88%] min-w-0 rounded-2xl rounded-br-md border border-dashed border-act-line px-3.5 py-2.5 text-[13.5px] [overflow-wrap:anywhere]">
            <p>{queued}</p>
            <p className="mt-1 flex justify-between gap-3 text-[12px] text-dim">
              <span>Gửi khi trợ lý trả lời xong câu trên</span>
              <button type="button" className="text-act hover:underline" onClick={() => { setText(queued); setQueued(null); }}>Sửa</button>
            </p>
          </div>
        )}
        <div ref={end} />
      </div>

      <form className="shrink-0 px-3 pt-1 pb-3" onSubmit={(e) => { e.preventDefault(); void submit(text); }}>
        <div className="rounded-2xl border border-rule bg-panel shadow-[0_2px_12px_rgba(20,20,60,0.06)] transition-[border-color,box-shadow] focus-within:border-act-line focus-within:shadow-[0_0_0_3px_var(--color-act-soft)]">
          {!!files.length && <div className="px-3 pt-3"><Chips files={files} onRemove={(k) => setFiles((cur) => cur.filter((f) => f.key !== k))} /></div>}
          <textarea ref={box} rows={1} value={text} placeholder={ctx.placeholder} aria-label="Câu hỏi cho trợ lý"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) void submit(text); } }}
            onPaste={(e) => { const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/")); if (imgs.length) { e.preventDefault(); void add(imgs); } }}
            className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-relaxed outline-none placeholder:text-dim" />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
            <button type="button" aria-label="Đính kèm ảnh hoặc file" title="Đính kèm ảnh, hợp đồng, hoá đơn đã ký, Excel…"
              onClick={() => picker.current?.click()}
              className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink"><IconAttach width={18} height={18} /></button>
            <span className="ml-1 text-[11px] text-dim max-xl:hidden">Enter để gửi · Shift+Enter xuống dòng</span>
            <button type="submit" disabled={!canSend} aria-label="Gửi"
              className="ml-auto grid h-8 w-8 place-items-center rounded-xl bg-act text-on-act transition-[opacity,transform] hover:bg-act-hover active:scale-95 disabled:opacity-35">
              <IconSend width={17} height={17} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Questions to try, by page: a first message is easier to pick than to write. */
const SUGGEST: Record<string, string[]> = {
  contracts: ["Hợp đồng nào sắp hết hạn trong 60 ngày?", "Lọc giúp hợp đồng mua trên 100 triệu", "Bạn làm được những gì?"],
  contract: ["Hợp đồng này có điều khoản phạt gì?", "Có nên gia hạn hợp đồng này không?", "Tóm tắt hợp đồng này giúp mình"],
  partners: ["Đối tác nào cần chú ý nhất?", "Điểm uy tín được tính thế nào?", "Khách nào hay trả trễ?"],
  prices: ["Mặt hàng nào đang mua đắt nhất?", "So sánh giá các nhà cung cấp bao bì"],
  prices_cks: ["Gói chữ ký số nào lãi nhất?", "Giá thị trường chữ ký số 1 năm bao nhiêu?"],
  cks: ["Chữ ký nào sắp hết hạn tháng này?", "Nhập danh sách chữ ký số từ file Excel"],
  scoring: ["Điểm uy tín được tính lúc nào?", "Nên thêm tiêu chí tự chấm nào?"],
  other: ["Hôm nay mình cần làm gì?", "Bạn làm được những gì?"],
};