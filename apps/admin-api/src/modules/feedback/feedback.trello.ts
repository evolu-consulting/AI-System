// feedback · adapter Trello (app cũ mgmt-app đẩy mỗi góp ý thành một thẻ trong list "Mới"). Chạy SAU khi góp ý đã commit,
// không chặn người dùng, lỗi chỉ log cảnh báo (không có key/token). Thiếu cấu hình ⇒ bỏ qua. Key/token nằm trong body, không trong URL.
import type { FeedbackItem } from "@ai/contracts";
import { logger } from "../../lib/logger";
import type { DecodedFile } from "./feedback.rules";

export type TrelloConfig = { apiKey: string; token: string; listId: string };
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const API = "https://api.trello.com/1";
const NAME_MAX = 120;
const TIMEOUT_MS = 5_000;
const KIND_LABEL: Record<string, string> = { bug: "Lỗi", idea: "Ý tưởng", other: "Khác" };

/** Đủ cả ba biến mới bật; thiếu một ⇒ `undefined` (chỉ lưu trong app). */
export function trelloFromEnv(e: {
  TRELLO_API_KEY?: string;
  TRELLO_TOKEN?: string;
  TRELLO_FEEDBACK_LIST_ID?: string;
}): TrelloConfig | undefined {
  if (!e.TRELLO_API_KEY || !e.TRELLO_TOKEN || !e.TRELLO_FEEDBACK_LIST_ID) return undefined;
  return { apiKey: e.TRELLO_API_KEY, token: e.TRELLO_TOKEN, listId: e.TRELLO_FEEDBACK_LIST_ID };
}

/** Tên thẻ: `[Loại] đầu nội dung` (một dòng) ≤ 120 ký tự. */
export function cardName(f: Pick<FeedbackItem, "kind" | "message">): string {
  const head = f.message.replace(/\s+/g, " ").trim();
  const name = `[${KIND_LABEL[f.kind] ?? f.kind}] ${head}`;
  return name.length <= NAME_MAX ? name : `${name.slice(0, NAME_MAX - 1)}…`;
}

/** Chỉ origin + path: bỏ query/fragment (có thể chứa token/ID) trước khi gửi ra ngoài. */
export function safePage(u: string): string {
  try {
    const p = new URL(u);
    return `${p.origin === "null" ? `${p.protocol}` : p.origin}${p.pathname}`;
  } catch {
    return (u.split(/[?#]/)[0] ?? "").trim();
  }
}

/** Mô tả thẻ: nội dung + công ty/người gửi + app/trang/phiên bản. */
export function cardDesc(f: FeedbackItem): string {
  const meta = [
    `Công ty: ${f.tenant_name}`,
    `Người gửi: ${f.user_name}`,
    `App: ${f.app}`,
    safePage(f.page_url) ? `Trang: ${safePage(f.page_url)}` : "",
    f.app_version ? `Phiên bản: ${f.app_version}` : "",
    `Mã góp ý: ${f.id}`,
  ].filter(Boolean);
  return `${f.message}\n\n---\n${meta.join("\n")}`;
}

const MAX_CONCURRENT = 2;
const MAX_QUEUE = 50;
let active = 0;
const waiting: Array<() => void> = [];

/** Tối đa 2 lời gọi Trello cùng lúc trong tiến trình; hàng đợi > 50 ⇒ bỏ qua (ném, được log ở nơi gọi). */
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  if (waiting.length >= MAX_QUEUE) throw new Error("Trello queue full");
  await new Promise<void>((r) => waiting.push(r)); // slot được chuyển thẳng, không đổi `active`
}
function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

async function post(fetchFn: FetchFn, path: string, body: URLSearchParams | FormData) {
  await acquire();
  let res: Response;
  try {
    res = await fetchFn(`${API}${path}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } finally {
    release();
  }
  if (!res.ok) throw new Error(`Trello HTTP ${res.status}`);
  return res;
}

/** Tạo thẻ + đính kèm tệp. Không bao giờ ném; trả URL thẻ hoặc `null`. */
export async function pushFeedbackToTrello(
  cfg: TrelloConfig | undefined,
  item: FeedbackItem,
  files: DecodedFile[],
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  if (!cfg) return null;
  let card: { id?: string; shortUrl?: string; url?: string };
  try {
    const form = new URLSearchParams({
      key: cfg.apiKey,
      token: cfg.token,
      idList: cfg.listId,
      name: cardName(item),
      desc: cardDesc(item),
    });
    card = (await (await post(fetchFn, "/cards", form)).json()) as typeof card;
  } catch (err) {
    logger.warn("feedback-trello-card-failed", { feedback_id: item.id, error: errName(err) });
    return null;
  }
  if (!card.id) {
    logger.warn("feedback-trello-no-card-id", { feedback_id: item.id });
    return card.shortUrl ?? card.url ?? null;
  }
  for (const f of files) {
    try {
      const fd = new FormData();
      fd.set("key", cfg.apiKey);
      fd.set("token", cfg.token);
      fd.set("name", f.name);
      fd.set("mimeType", f.mime);
      fd.set("file", new Blob([new Uint8Array(f.bytes)], { type: f.mime }), f.name);
      await post(fetchFn, `/cards/${card.id}/attachments`, fd);
    } catch (err) {
      logger.warn("feedback-trello-attach-failed", { feedback_id: item.id, error: errName(err) });
    }
  }
  return card.shortUrl ?? card.url ?? null;
}

/** Chỉ tên lỗi/HTTP status — không đưa message gốc (có thể chứa URL/giá trị lạ) vào log. */
function errName(err: unknown): string {
  if (err instanceof Error) return err.message.startsWith("Trello ") ? err.message : err.name;
  return "unknown";
}
