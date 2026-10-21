// price-scout · đọc cấu hình agent theo khoá cho cổng `lib/ai-client/agent-call.ts` (gói gọi agent một lượt). MỘT câu: lệnh hệ
// thống + runtime + bật + model (= model riêng của agent ?? bước 0 profile — như `/agent-settings`). Studio sửa ⇒ lượt sau thấy
// ngay (không cache: lời gọi agent luôn kèm lời gọi model, một câu SQL không đáng kể).
import type { Db } from "@ai/db";
import { sql } from "drizzle-orm";
import type { AgentSpec, AgentSpecOf } from "../../lib/ai-client/agent-call";

type Row = {
  id: string;
  enabled: boolean;
  runtime: string;
  system_prompt: string;
  model: string | null;
  entitled: boolean;
};

/**
 * agents-background · `tenantId` cho trước ⇒ thêm `entitled`: agent nền (`surface = 'background'`) bị tắt cho công ty khi có hàng
 * `agent_entitlements` đã thu hồi; agent chat luôn `true` (quyền chat do cổng quyền khác lo).
 */
export function agentSpecOf(db: Db): AgentSpecOf {
  return async (key, tenantId): Promise<AgentSpec | null> => {
    const t = tenantId ?? null;
    const [r] = await db.db.execute<Row>(sql`select a.id, a.enabled, a.runtime, a.system_prompt,
        coalesce(a.model, p.steps -> 0 ->> 'model') as model,
        not (a.surface = 'background' and ${t}::uuid is not null and exists (
          select 1 from hub.agent_entitlements e
          where e.agent_id = a.id and e.tenant_id = ${t}::uuid and e.revoked_at is not null)) as entitled
      from hub.agents a left join hub.model_profiles p on p.id = a.profile_id where a.key = ${key}`);
    return r
      ? {
          id: r.id,
          enabled: r.enabled,
          runtime: r.runtime,
          systemPrompt: r.system_prompt,
          model: r.model,
          entitled: r.entitled,
        }
      : null;
  };
}
