// M2-chat · token tool NGẮN HẠN cho agent Dify gọi `/mcp` của Hub (người dùng duyệt 2026-10-19): gắn user + tenant + run
// (phiên chat) của lời gọi, sống vài phút (TTL), CHỈ tool gói `action: read` không side_effect, thu hồi khi run kết thúc. Hub
// tiêm token vào `inputs` của đúng một tin gửi Dify (`hub_tool_token`) — Dify dùng làm Bearer khi gọi `/mcp`; hết run token chết
// nên bản Dify lưu trong log không dùng lại được. Không có token dài hạn/tài khoản dịch vụ. Lưu ở Redis theo sha256 (không
// lưu/log bản rõ); hết TTL ⇒ Redis tự xoá ⇒ `/mcp` 401. `exp` trong giá trị kiểm lại (phòng TTL Redis lệch).
import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "../../lib/redis";
import type { PackToolCatalog } from "../packs/kit/application/pack-tools.ports";

export const CHAT_TOKEN_PREFIX = "hct_";
const CHAT_TOKEN_RE = /^hct_[A-Za-z0-9_-]{43}$/;
/** Tên input của app Dify nhận token (app phải khai biến này thì Hub mới cấp — cấu hình, không đổi code). */
export const HUB_TOOL_TOKEN_INPUT = "hub_tool_token";
export const CHAT_TOKEN_TTL_MIN_S = 60;
export const CHAT_TOKEN_TTL_MAX_S = 900;
const KEY = (hash: string) => `mcp:chat-token:${hash}`;

export type ChatTokenClaims = {
  tenantId: string;
  userId: string;
  runId: string;
  conversationId: string;
  agentId: string;
  /** Khoá tool gói `read` được phép (đã lọc lúc cấp). */
  tools: string[];
  /** Hết hạn (ms epoch). */
  exp: number;
};

export type ChatTokenStore = {
  put(hash: string, c: ChatTokenClaims, ttlS: number): Promise<void>;
  get(hash: string): Promise<ChatTokenClaims | null>;
  del(hash: string): Promise<void>;
};

export const isChatToken = (s: string): boolean => CHAT_TOKEN_RE.test(s);
const hashOf = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export function redisChatTokenStore(redis: Pick<Redis, "set" | "get" | "del">): ChatTokenStore {
  return {
    async put(hash, c, ttlS) {
      await redis.set(KEY(hash), JSON.stringify(c), "EX", ttlS);
    },
    async get(hash) {
      const raw = await redis.get(KEY(hash));
      return raw ? (JSON.parse(raw) as ChatTokenClaims) : null;
    },
    async del(hash) {
      await redis.del(KEY(hash));
    },
  };
}

/** TTL theo hạn run của agent, kẹp [60 s, 15 phút]. */
export const chatTokenTtlS = (agentTimeoutS: number): number =>
  Math.min(CHAT_TOKEN_TTL_MAX_S, Math.max(CHAT_TOKEN_TTL_MIN_S, Math.ceil(agentTimeoutS)));

export type IssuedChatToken = { token: string; revoke: () => Promise<void> };

export class ChatToolTokens {
  constructor(
    private readonly d: {
      store: ChatTokenStore;
      packs: Pick<PackToolCatalog, "info">;
      now?: () => number;
    },
  ) {}

  #now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** Chỉ tool có trong registry, `action: read`, không side_effect. */
  readTools(keys: readonly string[]): string[] {
    return keys.filter((k) => {
      const i = this.d.packs.info(k);
      return i !== undefined && !i.sideEffect && i.action === "read";
    });
  }

  /** Cấp token cho một run; không còn tool đọc nào ⇒ null (không cấp). */
  async issue(
    c: Omit<ChatTokenClaims, "exp" | "tools">,
    keys: readonly string[],
    ttlS: number,
  ): Promise<IssuedChatToken | null> {
    const tools = this.readTools(keys);
    if (tools.length === 0) return null;
    const token = `${CHAT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const hash = hashOf(token);
    await this.d.store.put(hash, { ...c, tools, exp: this.#now() + ttlS * 1000 }, ttlS);
    return { token, revoke: () => this.d.store.del(hash) };
  }

  /** Token → claims; sai dạng / không có / hết hạn ⇒ null. Lọc lại tool đọc (registry đổi giữa chừng). */
  async resolve(token: string): Promise<ChatTokenClaims | null> {
    if (!isChatToken(token)) return null;
    const c = await this.d.store.get(hashOf(token));
    if (!c || c.exp <= this.#now()) return null;
    return { ...c, tools: this.readTools(c.tools) };
  }
}
