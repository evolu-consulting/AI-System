// CR-114 hub-fast-sdk · dựng request Messages API có prompt caching (prefix match: đổi một byte trong tiền tố ⇒ mất cache
// phần sau). Thứ tự CỐ ĐỊNH, ổn định nhất trước: system (lời nhắc agent) → tools (sắp theo tên) → ngữ cảnh tenant/agent
// (khối system thứ hai) → history (mọi tin là mảng khối text, kể cả tin cuối) → lượt này (phần biến động: dòng giờ, prompt)
// SAU breakpoint cuối. Breakpoint `cache_control` (≤ 4): cuối system, cuối ngữ cảnh, cuối history. Lượt N+1 = lượt N +
// [user, assistant] ⇒ tiền tố tới breakpoint history của lượt N là tiền tố byte của lượt N+1 (đọc lại cache).
// Bẫy: cửa sổ `history_n` trượt (hội thoại dài hơn N) ⇒ tiền tố history đổi mỗi lượt — chỉ phần system/ngữ cảnh còn trúng.
import type Anthropic from "@anthropic-ai/sdk";

type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;
/** Tool tự định nghĩa (có `name`); tool server không dùng ở đây. */
type Tool = Anthropic.Beta.BetaTool;

export type CacheTurn = { role: "user" | "assistant"; content: string };
export type CachedPromptInput = {
  /** Lời nhắc hệ thống của agent (ổn định theo phiên bản agent). */
  system: string;
  tools?: readonly Tool[];
  /** Ngữ cảnh tenant/agent ổn định trong ngày (không chứa giờ/phút). */
  context?: string;
  history: readonly CacheTurn[];
  /** Phần biến động của lượt này (vd dòng "Thời điểm hiện tại") — sau breakpoint cuối. */
  volatile?: string;
  prompt: string;
};
export type CachedPrompt = { system: TextBlock[]; tools?: Tool[]; messages: MessageParam[] };

const EPHEMERAL = { type: "ephemeral" } as const;
const text = (t: string, cache = false): TextBlock =>
  cache ? { type: "text", text: t, cache_control: EPHEMERAL } : { type: "text", text: t };

/** Tin đầu phải là `user`: bỏ các tin `assistant` dẫn đầu (cửa sổ history có thể cắt giữa cặp). */
function historyMessages(h: readonly CacheTurn[]): MessageParam[] {
  const start = h.findIndex((m) => m.role === "user");
  if (start < 0) return [];
  const rows = h.slice(start).filter((m) => m.content.length > 0);
  return rows.map((m, i) => ({ role: m.role, content: [text(m.content, i === rows.length - 1)] }));
}

const byName = (a: Tool, b: Tool): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function cachedPrompt(i: CachedPromptInput): CachedPrompt {
  const system = [text(i.system, true)];
  if (i.context) system.push(text(i.context, true));
  const turn: TextBlock[] = [];
  if (i.volatile) turn.push(text(i.volatile));
  turn.push(text(i.prompt));
  const messages = [...historyMessages(i.history), { role: "user" as const, content: turn }];
  return {
    system,
    ...(i.tools?.length ? { tools: [...i.tools].sort(byName) } : {}),
    messages,
  };
}

/** Khối dịch cửa sổ history (số tin): 8 lượt = 16 tin, không quá nửa `history_n` (giữ ≥ n/2 tin). */
export const historyBlock = (n: number): number => Math.max(2, Math.min(16, Math.floor(n / 2)));

/**
 * CR-114 · cửa sổ history dịch THEO KHỐI: `total` tin của flow, lấy `n` tin cuối ⇒ số tin bỏ ở đầu cửa sổ để điểm bắt đầu
 * (tuyệt đối) là bội của `block` — giữ nguyên qua `block` tin mới ⇒ tiền tố history (cache) ổn định thay vì đổi mỗi lượt.
 * Giữ lại trong (n − block, n] tin. Chưa đầy cửa sổ ⇒ 0 (không bỏ).
 */
export function blockWindowDrop(total: number, n: number, block: number): number {
  if (total <= n || block <= 1) return 0;
  const start = Math.ceil((total - n) / block) * block;
  return start - (total - n);
}

/** Tổng token prompt (input chưa cache + đọc cache + ghi cache) — dùng cho trần (không đếm thiếu khi trúng cache). */
export const promptTokens = (u: {
  input_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number =>
  u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
