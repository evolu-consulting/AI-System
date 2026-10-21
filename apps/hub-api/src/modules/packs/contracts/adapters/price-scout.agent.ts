// price-scout · cổng `ScoutAgent` qua cổng nền gọi agent Hub (`lib/ai-client/agent-call`): agent `price-scout` (model + lệnh hệ
// thống ở Hub/Studio), tìm web bật, usage app `contracts` · feature `contracts.price_scout` · trigger · id SP. Không bao giờ ném.
import type { AgentCaller } from "../../../../lib/ai-client/agent-call";
import type { ScoutAgent } from "../application/price-scout.ports";
import { SCOUT_AGENT, SCOUT_APP, SCOUT_FEATURE } from "../domain/price-scout.rules";

export function scoutAgent(agents: AgentCaller): ScoutAgent {
  return async (r) => {
    const out = await agents.call({
      tenantId: r.tenantId,
      userId: r.userId,
      agentKey: SCOUT_AGENT,
      feature: SCOUT_FEATURE,
      app: SCOUT_APP,
      trigger: r.trigger,
      subjectId: r.productId,
      prompt: r.prompt,
      webSearch: true,
      signal: r.signal,
    });
    if (!out.ok) return { ok: false, code: out.code };
    const u = out.usage;
    return { ok: true, text: out.text, tokens: u.inputTokens + u.outputTokens };
  };
}
