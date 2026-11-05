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
import type { CommunityFlowOpts } from "./community/community.mount";
import { SLOT_MODERATION } from "./community/domain/flow.rules";
import type { PackRunsBridge } from "./kit/application/pack-runs.ports";
import type { PackWho } from "./kit/application/ports";

/** Agent `community-screen`/`community-triage` qua AI client chung (trần token/usage theo tenant). */
export function communityAgents(
  db: Db,
  limitsOf: TenantLimitsOf,
  redis: Redis | undefined,
): AgentCaller {
  const ai = createHubAiClient(db, { limitsOf, ...(redis ? { redis } : {}) });
  return createAgentCaller(ai, agentSpecOf(db));
}

/** CR-121 C-7 · khe duyệt HĐ của Sổ Hợp Tác (khoá khe + khoá gói). */
const CONTRACTS_PACK = "contracts";
const CONTRACTS_APPROVAL_SLOT = "contracts.approval";

/** Hộp "Chờ tôi duyệt": cần quyền đọc gói contracts + engine bật; hiện khi có việc HOẶC là người duyệt của quy trình đang gán. */
export function contractsInboxOf(
  runs: PackRunsBridge | undefined,
  canRead: (who: PackWho) => Promise<boolean>,
): NonNullable<CommunityFlowOpts["contractsInbox"]> {
  return async (who) => {
    const port = runs?.port;
    if (!port?.inboxOf || !(await canRead(who))) return { visible: false, count: 0 };
    const r = await port.inboxOf(
      { userId: who.userId, tenantId: who.tenantId, role: "member" },
      CONTRACTS_PACK,
      CONTRACTS_APPROVAL_SLOT,
    );
    return { visible: r.count > 0 || r.approver, count: r.count };
  };
}

export function communityFlowPorts(
  db: Db,
  agents: AgentCaller | undefined,
  contractsInbox?: CommunityFlowOpts["contractsInbox"],
): CommunityFlowOpts {
  return {
    agents,
    contractsInbox,
    moderationOn: async (tenantId) => {
      const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ on: boolean }>(sql`select (
            exists (select 1 from hub.process_routing_rules x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
            or exists (select 1 from hub.process_tenant_defs x where x.tenant_id = ${tenantId}::uuid and x.slot = ${SLOT_MODERATION})
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
