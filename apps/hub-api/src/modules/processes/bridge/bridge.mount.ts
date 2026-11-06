// CR-122 · N2 · dựng cổng gọi agent Hub `flow-bridge` cho "Gợi ý cầu nối": AI client chung (trần token/tenant/ngày + bucket/phút + một dòng
// usage `flow.bridge`) + cấu hình agent từ Studio (`hub.agents`). Không gọi thẳng nhà cung cấp LLM. Test không khoá AI ⇒ `UNAVAILABLE`.
import { type AgentCaller, createAgentCaller } from "../../../lib/ai-client/agent-call";
import { createHubAiClient } from "../../../lib/ai-client/ai-client.env";
import type { Db } from "../../../lib/db";
import type { Redis } from "../../../lib/redis";
import { agentSpecOf } from "../../agents/agent-spec.service";
import type { ConfigCache } from "../../config/public";

export function bridgeAgentOf(m: {
  db: Db;
  redis?: Redis | undefined;
  config: ConfigCache;
}): AgentCaller {
  const ai = createHubAiClient(m.db, {
    limitsOf: async (tid) => (await m.config.tenant(tid))?.dailyLimits,
    ...(m.redis ? { redis: m.redis } : {}),
  });
  return createAgentCaller(ai, agentSpecOf(m.db));
}
