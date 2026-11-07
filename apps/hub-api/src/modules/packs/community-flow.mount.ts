// CR-120 · cr120-community-flows · cổng hub cho 3 khe Community (gói không đọc bảng hub — D-06; nối ở đây như `community-wire`):
//   moderationOn(tenant) — khe `community.post-moderation` do platform admin GÁN (OPT-IN): có luật định tuyến thật HOẶC quy trình trong
//     tập gán (`process_tenant_defs` — đúng thứ màn "Được platform gán" ghi) ⇒ bài mới vào duyệt. KHÔNG xét đầu luật rỗng (cấp tự
//     động cũ) và view gán cũ (D6). Hub không còn tự cấp khe này (SlotSpec.optIn). MỘT câu theo PK/index, scope system.
//   tenantAdmin(who)     — `admin.users.role = 'tenant_admin'` (cột hub_ro 0002), MỘT câu.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { type AgentCaller, createAgentCaller } from "../../lib/ai-client/agent-call";
import { createHubAiClient, type TenantLimitsOf } from "../../lib/ai-client/ai-client.env";
import type { Redis } from "../../lib/redis";
import { agentSpecOf } from "../agents/agent-spec.service";
import { flowTriggersOn } from "../processes/triggers/flags";
import type { CommunityFlowOpts } from "./community/community.mount";
import { SLOT_MODERATION } from "./community/domain/flow.rules";
import { moduleRegistry } from "./kit/public";

/** Agent `community-screen`/`community-triage` qua AI client chung (trần token/usage theo tenant). */
export function communityAgents(
  db: Db,
  limitsOf: TenantLimitsOf,
  redis: Redis | undefined,
): AgentCaller {
  const ai = createHubAiClient(db, { limitsOf, ...(redis ? { redis } : {}) });
  return createAgentCaller(ai, agentSpecOf(db));
}

export function communityFlowPorts(db: Db, agents: AgentCaller | undefined): CommunityFlowOpts {
  return {
    agents,
    // CR-122 · A2: cờ `FLOW_TRIGGERS` (một nguồn: `processes/triggers/flags`) + đăng ký cổng app cho engine lúc mount
    triggersOn: (tenantId) =>
      withHubScope(db, { kind: "system" }, (tx) => flowTriggersOn(tx, tenantId)),
    registerPorts: ({ readers, handler }) => {
      for (const r of readers) moduleRegistry.bindEvent({ facts: r });
      moduleRegistry.bindEvent({ outcome: handler });
      moduleRegistry.bindNode({ key: "community.show-post" }); // CR-125 · m2 · Hiện bài = kết quả `shown` do handler trên xử lý
    },
    moderationOn: async (tenantId) => {
      // CR-122: flow gán qua `company_flows` (sự kiện `post.created`, đang bật) + cờ FLOW_TRIGGERS bật ⇒ bài vào "Chờ duyệt" để flow quyết.
      // Một câu, cùng tx với cờ ⇒ gán/bật xong có hiệu lực ngay (không cache).
      const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ on: boolean }>(sql`select (
            exists (select 1 from hub.process_routing_rules x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
            or exists (select 1 from hub.process_tenant_defs x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
            or (exists (select 1 from hub.tenant_flow_settings s where s.tenant_id = ${tenantId}::uuid and s.flow_triggers)
              and exists (select 1 from hub.company_flows cf
                join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null
                  and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
                where cf.tenant_id = ${tenantId}::uuid and cf.enabled and d.trigger_event = 'post.created'))
          ) as on`),
      );
      return r?.on === true;
    },
    tenantAdmin: async (who) => {
      const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{
          ok: boolean;
        }>(sql`select exists (select 1 from admin.users u where u.id = ${who.userId}::uuid
            and u.tenant_id = ${who.tenantId}::uuid and u.role = 'tenant_admin') as ok`),
      );
      return r?.ok === true;
    },
  };
}
