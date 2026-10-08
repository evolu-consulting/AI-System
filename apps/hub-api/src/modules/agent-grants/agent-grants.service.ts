// HUB-FR-78 · HUB-BR-17 · ADM-FR-37 · H3b-R04–R08, R11, R16 · nghiệp vụ `/agent-grants` (plan H3b §5.2, §5.3, §6).
// Nhận tenant đích `T` ĐÃ chốt (route gọi `targetTenant` một lần — P7); mọi câu repo lọc `tenant_id = T`.
// Ghi có đổi: một transaction `config_meta` FOR UPDATE → `agent_grants` → bump → audit → NOTIFY (giao khi commit).
// Trùng/không có hàng ⇒ commit không bump/audit/NOTIFY (grant là tập hợp, R06/R07).
import {
  AGENT_GRANTS_AGENTS_MAX,
  type AgentGrant,
  type AgentGrantListResponse,
  type AgentGrantWriteResponse,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import { grantEntityName, type HubAuditWriter } from "../../lib/hub-audit";
import { bumpHubConfig, lockHubConfig, notifyHubConfig } from "../../lib/hub-config-write";
import { listItems, subjectKey, subjectRef } from "./agent-grants.map";
import {
  type AgentCheckRow,
  actorName,
  agentCheck,
  currentVersion,
  deleteGrant,
  findGrant,
  findSubject,
  type GrantKey,
  insertGrant,
  listAgents,
  listGrants,
  type SubjectRow,
  tenantExists,
} from "./agent-grants.repo";
import { grantProblem } from "./agent-grants.rules";

export type GrantWriteResult = { created: boolean; body: AgentGrantWriteResponse };
type Checked = { agent: AgentCheckRow; subject: SubjectRow };

const scopeOf = (actor: AuthUser, tenantId: string): HubScope => ({
  kind: "user",
  tenantId,
  userId: actor.userId,
});

/** R04 · thứ tự lỗi theo `grantProblem` (không phụ thuộc role); không ghi gì khi lỗi. */
async function checkGrant(tx: Tx, tenantId: string, k: GrantKey): Promise<Checked> {
  const agent = await agentCheck(tx, tenantId, k.agentId);
  const subject = agent && (await findSubject(tx, tenantId, k.subjectType, k.subjectId));
  const problem = grantProblem({ agent, subjectInTenant: subject != null });
  if (problem === "AGENT_NOT_FOUND_REF") throw appError("INVALID_REFERENCE", { field: "agent_id" });
  if (problem === "AGENT_NOT_GRANTABLE") throw appError("AGENT_NOT_GRANTABLE");
  if (problem === "NOT_ENTITLED") throw appError("NOT_ENTITLED", { agent_ids: [k.agentId] });
  if (problem !== null || !agent || !subject)
    throw appError("INVALID_REFERENCE", { field: "subject_id" });
  return { agent, subject };
}

const auditKeys = (k: GrantKey, agentKey: string, subjectKeyOf: string) => ({
  agent_id: k.agentId,
  agent_key: agentKey,
  subject_type: k.subjectType,
  subject_id: k.subjectId,
  subject_key: subjectKeyOf,
});

/** `AgentGrant` của POST (201/200) từ agent + subject đã kiểm. */
const grantBuilder =
  (tenantId: string, c: Checked) =>
  (id: string, by: string | null, at: string): AgentGrant => ({
    id,
    tenant_id: tenantId,
    agent: { id: c.agent.id, key: c.agent.key, name: c.agent.name },
    subject: subjectRef(c.subject),
    granted_by: by,
    granted_at: at,
  });

export class AgentGrantsService {
  constructor(private readonly d: { db: Db; audit: HubAuditWriter }) {}

  /** platform_admin chọn tenant bằng query ⇒ kiểm tồn tại (404); tenant_admin luôn là tenant JWT. */
  private async ensureTenant(tx: Tx, actor: AuthUser, tenantId: string): Promise<void> {
    if (actor.role === "platform_admin" && !(await tenantExists(tx, tenantId)))
      throw appError("NOT_FOUND");
  }

  /** POST · 201 mới (bump + audit `grant` + NOTIFY) · 200 trùng (hàng gốc, version hiện tại, không ghi). */
  grant(actor: AuthUser, tenantId: string, k: GrantKey): Promise<GrantWriteResult> {
    return withHubScope(this.d.db, scopeOf(actor, tenantId), async (tx) => {
      await this.ensureTenant(tx, actor, tenantId);
      const checked = await checkGrant(tx, tenantId, k);
      const locked = await lockHubConfig(tx);
      const ins = await insertGrant(tx, tenantId, k, actor.userId);
      const grantOf = grantBuilder(tenantId, checked);
      if (!ins) {
        // Trùng: hàng gốc (G13). Đang giữ khoá config_meta ⇒ không ghi grant nào chen vào giữa INSERT và SELECT.
        const found = await findGrant(tx, tenantId, k);
        if (!found) throw new Error("agent_grants: ON CONFLICT nhưng không thấy hàng");
        const grant = grantOf(found.id, await actorName(tx, found.grantedBy), found.grantedAt);
        return { created: false, body: { grant, hub_config_version: locked } };
      }
      const version = await bumpHubConfig(tx);
      const by = await actorName(tx, actor.userId);
      const sKey = subjectKey(checked.subject);
      await this.d.audit.insert(tx, {
        ...this.auditBase(actor, tenantId, by, version),
        action: "grant",
        entityId: ins.id,
        entityName: grantEntityName(checked.agent.key, sKey),
        before: null,
        after: auditKeys(k, checked.agent.key, sKey),
      });
      await notifyHubConfig(tx, version);
      return {
        created: true,
        body: { grant: grantOf(ins.id, by, ins.grantedAt), hub_config_version: version },
      };
    });
  }

  /** DELETE · có hàng của T ⇒ xoá + bump + audit `revoke` + NOTIFY; không có (kể cả hàng tenant khác) ⇒ không ghi. */
  revoke(actor: AuthUser, tenantId: string, k: GrantKey): Promise<void> {
    return withHubScope(this.d.db, scopeOf(actor, tenantId), async (tx) => {
      await this.ensureTenant(tx, actor, tenantId);
      await lockHubConfig(tx);
      const del = await deleteGrant(tx, tenantId, k);
      if (!del) return;
      const version = await bumpHubConfig(tx);
      const agent = await agentCheck(tx, tenantId, k.agentId);
      const subject = await findSubject(tx, tenantId, k.subjectType, k.subjectId);
      // Subject mồ côi (Admin đã xoá group/user — không FK chéo schema) ⇒ không có key, dùng id cho `entity_name`.
      const sKey = subject ? subjectKey(subject) : null;
      const agentKey = agent?.key ?? k.agentId;
      const by = await actorName(tx, actor.userId);
      await this.d.audit.insert(tx, {
        ...this.auditBase(actor, tenantId, by, version),
        action: "revoke",
        entityId: del.id,
        entityName: grantEntityName(agentKey, sKey ?? k.subjectId),
        before: {
          ...auditKeys(k, agentKey, sKey ?? k.subjectId),
          granted_by: del.grantedBy,
          granted_at: del.grantedAt,
        },
        after: null,
      });
      await notifyHubConfig(tx, version);
    });
  }

  /** GET · đọc DB (thấy ngay sau POST — PL5) trong một ảnh REPEATABLE READ: version khớp danh sách. */
  list(
    actor: AuthUser,
    tenantId: string,
    subject: { type: "group" | "user" | "tenant"; id: string } | null,
  ): Promise<AgentGrantListResponse> {
    return withHubScope(
      this.d.db,
      scopeOf(actor, tenantId),
      async (tx) => {
        await this.ensureTenant(tx, actor, tenantId);
        const version = await currentVersion(tx);
        const agents = await listAgents(tx, tenantId, AGENT_GRANTS_AGENTS_MAX + 1);
        const kept = agents.slice(0, AGENT_GRANTS_AGENTS_MAX);
        const grants = await listGrants(
          tx,
          tenantId,
          kept.map((a) => a.id),
          subject,
        );
        return {
          tenant_id: tenantId,
          items: listItems(kept, grants),
          truncated: agents.length > AGENT_GRANTS_AGENTS_MAX,
          hub_config_version: version,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  private auditBase(actor: AuthUser, tenantId: string, by: string | null, version: number) {
    return {
      tenantId,
      actorId: actor.userId,
      actorUsername: by,
      actorRole: actor.role,
      entity: "agent_grant" as const,
      hubConfigVersion: version,
      summary: {},
    };
  }
}
