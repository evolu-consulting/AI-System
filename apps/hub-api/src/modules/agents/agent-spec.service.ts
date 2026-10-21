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
};

export function agentSpecOf(db: Db): AgentSpecOf {
  return async (key): Promise<AgentSpec | null> => {
    const [r] = await db.db.execute<Row>(sql`select a.id, a.enabled, a.runtime, a.system_prompt,
        coalesce(a.model, p.steps -> 0 ->> 'model') as model
      from hub.agents a left join hub.model_profiles p on p.id = a.profile_id where a.key = ${key}`);
    return r
      ? {
          id: r.id,
          enabled: r.enabled,
          runtime: r.runtime,
          systemPrompt: r.system_prompt,
          model: r.model,
        }
      : null;
  };
}
