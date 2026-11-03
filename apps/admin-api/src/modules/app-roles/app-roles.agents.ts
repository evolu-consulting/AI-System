// CR-112 S6 · ADM-FR-80: Group của vai TUỲ BIẾN nhận đúng grant agent trợ lý gói mà Group vai mặc định cùng gói + cùng mức đang
// có (`admin.app_roles_grant_agents`, SECURITY DEFINER — admin_api không ghi bảng hub). Có chèn ⇒ hàm đã bump
// `hub.config_meta`; ở đây NOTIFY `hub_config_changed` trong cùng tx (giao khi commit) + audit mỗi grant agent.

import { HUB_CONFIG_CHANNEL, HUB_CONTRACT_VERSION } from "@ai/contracts/hub";
import type { ConfigSink, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../lib/audit/audit.write";

export type AgentGrantAdded = { g: string; a: string };

/** `roleIds` null ⇒ mọi vai tuỳ biến của tenant. Trả các grant agent vừa chèn. */
export async function grantRoleAgents(
  tx: Tx,
  a: { tenantId: string; roleIds: readonly string[] | null; actorId: string | null },
): Promise<AgentGrantAdded[]> {
  const ids = a.roleIds === null ? null : `{${a.roleIds.join(",")}}`;
  const [r] = (await tx.execute(
    sql`select admin.app_roles_grant_agents(${a.tenantId}::uuid, ${ids}::uuid[], ${a.actorId}::uuid) as r`,
  )) as unknown as { r: { v: number | string | null; added: AgentGrantAdded[] } }[];
  const out = r?.r ?? { v: null, added: [] };
  if (out.v !== null) {
    const payload = JSON.stringify({ v: HUB_CONTRACT_VERSION, version: Number(out.v) });
    await tx.execute(sql`select pg_notify(${HUB_CONFIG_CHANNEL}, ${payload})`);
  }
  return out.added;
}

/** Một dòng audit mỗi grant agent mới (entity `group` — Group nhận agent; không thêm enum audit). */
export function recordAgentGrants(
  ch: ConfigSink,
  tenantId: string,
  added: readonly AgentGrantAdded[],
  groupKey: (groupId: string) => string,
): void {
  for (const x of added)
    ch.audit(
      auditOf("update", "group", {
        entityId: x.g,
        entityName: groupKey(x.g),
        tenantId,
        before: null,
        after: null,
        summary: { op: "role.agent_grant", agent_id: x.a },
      }),
    );
  if (added.length > 0) ch.changed({ entity: "group", tenantId });
}
