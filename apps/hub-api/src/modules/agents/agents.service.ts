// HUB-FR-92 · H2b-R11 · menu `@` từ cache cấu hình (plan §4, §7: 0 query khi cache nóng). Quyền tính trên ảnh hiện hành.
import type { AgentMenuResponse } from "@ai/contracts/chat";
import type { AuthUser } from "../../lib/auth.middleware";
import type { ConfigCache } from "../config/config.service";
import { agentMenu } from "./agent-menu.rules";

export type AgentsConfig = Pick<ConfigCache, "snapshot" | "user">;

export class AgentsService {
  constructor(private readonly config: AgentsConfig) {}

  /** GET `/agents` · AU của user sắp `key` (nhóm user lấy từ cache H1). */
  async menu(u: AuthUser): Promise<AgentMenuResponse> {
    const [snapshot, user] = await Promise.all([
      this.config.snapshot(),
      this.config.user(u.userId),
    ]);
    const groupIds = user?.groupIds ?? new Set<string>();
    return { items: agentMenu(snapshot, { tenantId: u.tenantId, userId: u.userId, groupIds }) };
  }
}
