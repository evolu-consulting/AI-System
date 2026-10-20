// M2-chat · quyền tool NGẮN HẠN cho agent Dify gọi `/mcp` của Hub (người dùng duyệt 2026-10-19; sửa review A-5/A-18, m2c):
// app chat Dify GIỮ `inputs` của lượt đầu suốt hội thoại ⇒ token theo từng tin không tới được lượt 2. Tách hai phần:
//  · **handle** (`hct_…`, gửi Dify qua `inputs.hub_tool_token` khi MỞ hội thoại Dify): chỉ gắn hội thoại Hub + agent + user +
//    tenant, tự nó KHÔNG cho quyền gì; sống trượt `HANDLE_TTL_S` (gia hạn mỗi lượt), hết ⇒ Hub mở hội thoại Dify mới.
//  · **grant** của LƯỢT (run) đang chạy: tool đọc + `runId` + `exp` (TTL theo hạn run, kẹp [60 s, 1 giờ]); cấp khi run bắt đầu,
//    THU HỒI khi run kết thúc (chỉ xoá nếu còn là grant của run đó). `/mcp` nhận handle ⇒ chỉ chạy khi có grant còn hạn VÀ run
//    còn `running` (DB — process Hub chết giữa run thì không còn dùng được).
// Chỉ tool gói `action: read` không side_effect (lọc lúc cấp và lúc dùng). Redis giữ sha256 của handle, không bản rõ, không log.
import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "../../lib/redis";
import type { PackToolCatalog } from "../packs/kit/application/pack-tools.ports";

export const CHAT_TOKEN_PREFIX = "hct_";
const CHAT_TOKEN_RE = /^hct_[A-Za-z0-9_-]{43}$/;
/** Tên input của app Dify nhận handle (app phải khai biến này thì Hub mới cấp — cấu hình, không đổi code). */
export const HUB_TOOL_TOKEN_INPUT = "hub_tool_token";
export const CHAT_TOKEN_TTL_MIN_S = 60;
export const CHAT_TOKEN_TTL_MAX_S = 3600;
/** Handle sống trượt 24 giờ không hoạt động. */
export const HANDLE_TTL_S = 86_400;

const K = {
  handle: (hash: string) => `mcp:chat-handle:${hash}`,
  conv: (conv: string, agent: string) => `mcp:chat-conv:${conv}:${agent}`,
  grant: (conv: string, agent: string) => `mcp:chat-grant:${conv}:${agent}`,
};

export type ChatBinding = {
  tenantId: string;
  userId: string;
  conversationId: string;
  agentId: string;
};
export type ChatTokenClaims = ChatBinding & {
  runId: string;
  /** Khoá tool gói `read` được phép (đã lọc lúc cấp). */
  tools: string[];
  /** Hết hạn (ms epoch). */
  exp: number;
};

/** KV tối thiểu (Redis thật / bộ nhớ ở unit test). */
export type ChatTokenStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS: number): Promise<void>;
  expire(key: string, ttlS: number): Promise<boolean>;
  del(key: string): Promise<void>;
};

export const isChatToken = (s: string): boolean => CHAT_TOKEN_RE.test(s);
const hashOf = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export function redisChatTokenStore(
  redis: Pick<Redis, "set" | "get" | "del" | "expire">,
): ChatTokenStore {
  return {
    get: (k) => redis.get(k),
    async set(k, v, ttlS) {
      await redis.set(k, v, "EX", ttlS);
    },
    expire: async (k, ttlS) => (await redis.expire(k, ttlS)) === 1,
    async del(k) {
      await redis.del(k);
    },
  };
}

/** TTL grant theo hạn run của agent, kẹp [60 s, 1 giờ] (run quá 1 giờ thì mất tool — giới hạn đã ghi). */
export const chatTokenTtlS = (agentTimeoutS: number): number =>
  Math.min(CHAT_TOKEN_TTL_MAX_S, Math.max(CHAT_TOKEN_TTL_MIN_S, Math.ceil(agentTimeoutS)));

export type ChatGrant = { revoke: () => Promise<void> };

const sameBinding = (a: ChatBinding, b: ChatBinding): boolean =>
  a.tenantId === b.tenantId &&
  a.userId === b.userId &&
  a.conversationId === b.conversationId &&
  a.agentId === b.agentId;

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

  /** Cấp grant cho run đang bắt đầu; không còn tool đọc nào ⇒ null. Thu hồi chỉ xoá nếu grant vẫn của run này. */
  async grant(
    c: ChatBinding & { runId: string },
    keys: readonly string[],
    ttlS: number,
  ): Promise<ChatGrant | null> {
    const tools = this.readTools(keys);
    if (tools.length === 0) return null;
    const key = K.grant(c.conversationId, c.agentId);
    const claims: ChatTokenClaims = { ...c, tools, exp: this.#now() + ttlS * 1000 };
    await this.d.store.set(key, JSON.stringify(claims), ttlS);
    return {
      revoke: async () => {
        const raw = await this.d.store.get(key);
        if (raw && (JSON.parse(raw) as ChatTokenClaims).runId === c.runId)
          await this.d.store.del(key);
      },
    };
  }

  /** Gia hạn handle của hội thoại (lượt 2+); không còn ⇒ false (người gọi mở hội thoại Dify mới + `newHandle`). */
  async refreshHandle(b: ChatBinding): Promise<boolean> {
    const hash = await this.d.store.get(K.conv(b.conversationId, b.agentId));
    if (!hash || !(await this.d.store.expire(K.handle(hash), HANDLE_TTL_S))) return false;
    await this.d.store.expire(K.conv(b.conversationId, b.agentId), HANDLE_TTL_S);
    return true;
  }

  /** Handle mới cho một hội thoại Dify mới (thay handle cũ của hội thoại Hub này). */
  async newHandle(b: ChatBinding): Promise<string> {
    const convKey = K.conv(b.conversationId, b.agentId);
    const old = await this.d.store.get(convKey);
    if (old) await this.d.store.del(K.handle(old));
    const token = `${CHAT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const hash = hashOf(token);
    await this.d.store.set(K.handle(hash), JSON.stringify(b), HANDLE_TTL_S);
    await this.d.store.set(convKey, hash, HANDLE_TTL_S);
    return token;
  }

  /** Handle → claims của grant ĐANG chạy; sai dạng / không handle / không grant / hết hạn / lệch danh tính ⇒ null. */
  async resolve(token: string): Promise<ChatTokenClaims | null> {
    if (!isChatToken(token)) return null;
    const rawB = await this.d.store.get(K.handle(hashOf(token)));
    if (!rawB) return null;
    const b = JSON.parse(rawB) as ChatBinding;
    const rawG = await this.d.store.get(K.grant(b.conversationId, b.agentId));
    if (!rawG) return null;
    const g = JSON.parse(rawG) as ChatTokenClaims;
    if (g.exp <= this.#now() || !sameBinding(b, g)) return null;
    return { ...g, tools: this.readTools(g.tools) };
  }
}
