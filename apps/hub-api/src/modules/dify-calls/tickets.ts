// dlc-dify · vé gọi ngược (flow ticket): Hub cấp khi một workflow Dify (vd quy trình DLC làm tool của agent) được gọi thay
// user; node HTTP của Dify gửi lại vé ở `POST /dify/agent-calls` để Hub chạy agent CHO ĐÚNG user + hội thoại đó, kể cả khi
// flow chạy lâu hơn hạn access token. Redis lưu SHA-256 của vé (không lưu vé), TTL 24 h; vé là 32 byte ngẫu nhiên base64url.
import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "../../lib/redis";

export type FlowTicket = {
  tenantId: string;
  userId: string;
  role: "platform_admin" | "tenant_admin" | "member";
  conversationId: string;
  /** Tên workflow cấp vé (để log / trace). */
  workflowKey: string;
};

export const TICKET_TTL_S = 24 * 3600;
const PREFIX = "hub:flow-ticket:";
const keyOf = (t: string) => PREFIX + createHash("sha256").update(t).digest("hex");

export type FlowTickets = {
  issue(t: FlowTicket): Promise<string>;
  resolve(ticket: string): Promise<FlowTicket | null>;
};

export function flowTickets(redis: Pick<Redis, "set" | "get">): FlowTickets {
  return {
    async issue(t) {
      const ticket = `ft_${randomBytes(32).toString("base64url")}`;
      await redis.set(keyOf(ticket), JSON.stringify(t), "EX", TICKET_TTL_S);
      return ticket;
    },
    async resolve(ticket) {
      if (!/^ft_[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
      const raw = await redis.get(keyOf(ticket));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as FlowTicket;
      } catch {
        return null;
      }
    },
  };
}
