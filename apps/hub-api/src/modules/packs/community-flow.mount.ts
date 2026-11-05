// CR-120 · cr120-community-flows · cổng hub cho 3 khe Community (gói không đọc bảng hub — D-06; nối ở đây như `community-wire`):
//   moderationOn(tenant) — khe `community.post-moderation` đã được cấp cho tenant (luật `process_routings` hoặc tập gán
//     `process_tenant_defs`, hoặc gán cũ) ⇒ bài mới vào duyệt. MỘT câu theo PK/index, scope system.
//   tenantAdmin(who)     — `admin.users.role = 'tenant_admin'` (cột hub_ro 0002), MỘT câu.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { type AgentCaller, createAgentCaller } from "../../lib/ai-client/agent-call";
import { createHubAiClient, type TenantLimitsOf } from "../../lib/ai-client/ai-client.env";
import type { Redis } from "../../lib/redis";
import { agentSpecOf } from "../agents/agent-spec.service";
import type { CommunityFlowOpts } from "./community/community.mount";
import { SLOT_MODERATION } from "./community/domain/flow.rules";

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
    moderationOn: async (tenantId) => {
      const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ on: boolean }>(sql`select (
            exists (select 1 from hub.process_routings x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
            or exists (select 1 from hub.process_tenant_defs x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
            or exists (select 1 from hub.process_slot_assignments x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
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
