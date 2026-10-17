import { api } from "@/api/client";
import type { Card } from "./cards";
import { tableViews } from "@/components/table";
import type { PageContext } from "./context";

/** The table each page shows (its useTable key). */
const TABLE_OF_PAGE: Record<string, string> = { contracts: "contracts", partners: "partners" };

type Handlers = {
  step: (s: string) => void; token: (t: string) => void; cards: (c: Card[]) => void;
  /** `changed`: the assistant did something (CLI backend), so the pages read fresh. */
  done: (chatId: string, changed: boolean) => void; error: (e: string) => void;
};

/** Streams one answer from POST /assistant. Events are `data: {...}`: {step} · {cards} · {token} · {error} · {done, chat_id}. */
export type ChatFile = { id: string; name: string; mime: string; size: number };

/** Files for the next question: stored on the server, then named by id in POST /assistant. */
export async function uploadChatFiles(files: File[]): Promise<ChatFile[]> {
  const f = new FormData();
  for (const x of files) f.append("files", x, x.name || "anh-dan.png");
  return api<ChatFile[]>("/assistant/files", { method: "POST", body: f });
}

export async function ask({ question, chatId, ctx, files }: { question: string; chatId: string | null; ctx: PageContext; files?: string[] },
  h: Handlers) {
  const r = await fetch("/api/assistant", {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, chat_id: chatId, files: files ?? [],
      // the table on screen at the moment of asking, so "these contracts" means the rows the person sees
      context: { page: ctx.page, id: ctx.id, view: tableViews.get(TABLE_OF_PAGE[ctx.page] ?? "") ?? null } }),
  }).catch(() => null);
  if (!r) return h.error("Không kết nối được máy chủ. Thử lại sau.");
  if (!r.ok || !r.body) return h.error(r.status === 401 ? "Phiên đăng nhập đã hết, hãy đăng nhập lại." : `Lỗi ${r.status}`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let ended = false;          // a "done" or "error" came: anything else means the stream was cut
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, "");
        buf = buf.slice(i + 2);
        let ev: { step?: string; token?: string; cards?: Card[]; error?: string; done?: boolean; chat_id?: string; changed?: boolean };
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.step) h.step(ev.step);
        if (ev.token) h.token(ev.token);
        if (ev.cards) h.cards(ev.cards);
        if (ev.error) { ended = true; h.error(ev.error.length > 30 ? ev.error : "Trợ lý gặp lỗi khi trả lời. Thử hỏi lại."); }
        if (ev.done && ev.chat_id) { ended = true; h.done(ev.chat_id, !!ev.changed); }
      }
    }
  } catch { /* the connection dropped mid-answer: handled below */ }
  // a proxy timeout or a dropped connection ends the stream without a word: never leave the panel "đang trả lời" for good
  if (!ended) h.error("Mất kết nối khi trợ lý đang trả lời. Câu trả lời có thể chưa đủ — hỏi lại hoặc tải lại trang để xem dữ liệu mới.");
}
