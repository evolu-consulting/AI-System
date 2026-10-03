// UC-02, UC-08, CHAT-AC-06, CHAT-AC-23, CHAT-AC-28, HUB-FR-45 · hàm thuần dùng chung client/mock/test (plan §2.7).
// Thuần: không I/O, không đọc đồng hồ (thời điểm truyền vào), chạy được ở trình duyệt.
import { CHAT_SCN_PREFIX, CHAT_TITLE_DERIVED_LEN, FLOW_IDLE_S } from "./entities";
import { type ChatEvent, ChatEventSchema, type RawSseEvent } from "./events";

const ELLIPSIS = "…";
const SCN_PREFIX_RE = new RegExp(`^${CHAT_SCN_PREFIX}\\S*\\s*`);

/** Tiêu đề tự sinh: bỏ `#scn:<tên>`, gộp khoảng trắng, cắt 40 code point (+ "…"); rỗng → "…". */
export function deriveTitle(content: string): string {
  const text = content.trimStart().replace(SCN_PREFIX_RE, "").replace(/\s+/g, " ").trim();
  if (text === "") return ELLIPSIS;
  const points = Array.from(text);
  if (points.length <= CHAT_TITLE_DERIVED_LEN) return text;
  return points.slice(0, CHAT_TITLE_DERIVED_LEN).join("") + ELLIPSIS;
}

/** Bỏ dấu tiếng Việt + lower-case để tìm kiếm ("Hoá đơn" → "hoa don"). */
export function foldVi(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
}

/** `q` trống (hoặc chỉ khoảng trắng) → true; ngược lại chứa không phân biệt hoa thường và dấu. */
export function matchesQuery(title: string, q: string | undefined): boolean {
  const needle = q?.trim() ?? "";
  if (needle === "") return true;
  return foldVi(title).includes(foldVi(needle));
}

/** Flow "nghỉ" khi `nowMs − lastActiveAt ≥ idleS` giây (client hiện "Đang mở lại flow…"). */
export function isFlowIdle(lastActiveAt: string, nowMs: number, idleS = FLOW_IDLE_S): boolean {
  return nowMs - Date.parse(lastActiveAt) >= idleS * 1000;
}

/** Chống lặp khi nối lại bằng `Last-Event-ID`. */
export function isNewEvent(id: number, lastId: number): boolean {
  return id > lastId;
}

type SseFrame = { id: string | null; event: string; data: string[] };

function emptyFrame(): SseFrame {
  return { id: null, event: "", data: [] };
}

/** Áp một dòng field vào khung; dòng bắt đầu bằng `:` là chú thích (heartbeat). */
function applyLine(frame: SseFrame, line: string): void {
  if (line.startsWith(":")) return;
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? "" : line.slice(colon + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  if (field === "data") frame.data.push(value);
  else if (field === "event") frame.event = value;
  else if (field === "id") frame.id = value;
}

/**
 * Parser SSE tăng dần: nhận chunk bất kỳ (có thể cắt giữa dòng), tách theo dòng trống,
 * chấp nhận `\n` và `\r\n`. Khung không có `data:` không phát (theo đặc tả SSE). Không parse JSON.
 */
export function createSseParser(onEvent: (e: RawSseEvent) => void): (chunk: string) => void {
  let buffer = "";
  let frame = emptyFrame();
  return (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const raw = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line !== "") applyLine(frame, line);
      else {
        if (frame.data.length > 0) {
          onEvent({ id: frame.id, event: frame.event || "message", data: frame.data.join("\n") });
        }
        frame = emptyFrame();
      }
      nl = buffer.indexOf("\n");
    }
  };
}

/** Khung thô → `ChatEvent` đã kiểm strict; ném `SyntaxError` (JSON) hoặc `ZodError`. */
export function toChatEvent(raw: RawSseEvent): ChatEvent {
  const data: unknown = JSON.parse(raw.data);
  return ChatEventSchema.parse({ id: Number(raw.id), event: raw.event, data });
}

/** Ngược của parser (mock/Hub dùng): `data` là JSON một dòng. */
export function encodeSseEvent(e: ChatEvent): string {
  return `id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}
