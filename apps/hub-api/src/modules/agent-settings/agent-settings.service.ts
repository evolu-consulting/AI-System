// HUB-FR-77 · HUB-FR-78 · CR-054 · `/agent-settings`: đọc agent của công ty + agent mặc định; đặt agent mặc định
// (tenant_admin / platform_admin); bật/tắt agent cho công ty (chỉ platform_admin). Ghi: khoá config_meta → ghi → bump →
// audit → NOTIFY (như `/agent-grants`); không đổi ⇒ không bump, không audit.
import type {
  AgentDefaults,
  AgentSettingsResponse,
  AgentSettingsWriteResponse,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { HubAuditWriter } from "../../lib/hub-audit";
import { bumpHubConfig, lockHubConfig, notifyHubConfig } from "../../lib/hub-config-write";
import * as repo from "./agent-settings.repo";
import {
  type AgentState,
  blocksDisable,
  defaultsProblem,
  normalizeDefaults,
} from "./agent-settings.rules";

const scopeOf = (actor: AuthUser, tenantId: string): HubScope => ({
  kind: "user",
  tenantId,
  userId: actor.userId,
});

const scopeOfList = (actor: AuthUser) =>
  actor.role === "platform_admin" ? ("catalog" as const) : ("entitled" as const);

const stateOf = (r: repo.SettingsAgentRow): AgentState => ({
  id: r.id,
  enabled: r.enabled,
  entitled: r.entitled,
  isOrchestrator: r.is_orch,
});

export class AgentSettingsService {
  constructor(private readonly d: { db: Db; audit: HubAuditWriter }) {}

  private async ensureTenant(tx: Tx, actor: AuthUser, tenantId: string): Promise<void> {
    if (actor.role === "platform_admin" && !(await repo.tenantExists(tx, tenantId)))
      throw appError("NOT_FOUND");
  }

  list(actor: AuthUser, tenantId: string): Promise<AgentSettingsResponse> {
    return withHubScope(this.d.db, scopeOf(actor, tenantId), async (tx) => {
      await this.ensureTenant(tx, actor, tenantId);
      const rows = await repo.listAgents(tx, tenantId, scopeOfList(actor));
      const version = await repo.configVersion(tx);
      return {
        defaults: await repo.readDefaults(tx, tenantId),
        agents: rows.map((r) => ({
          agent: { id: r.id, key: r.key, name: r.name },
          description: r.description,
          runtime: r.runtime,
          model: { value: r.model, display_name: r.model_name },
          enabled: r.enabled,
          entitled: r.entitled,
          is_orchestrator: r.is_orch,
        })),
        hub_config_version: version,
      };
    });
  }

  putDefaults(
    actor: AuthUser,
    tenantId: string,
    body: AgentDefaults,
  ): Promise<AgentSettingsWriteResponse> {
    return withHubScope(this.d.db, scopeOf(actor, tenantId), async (tx) => {
      await this.ensureTenant(tx, actor, tenantId);
      const locked = await lockHubConfig(tx);
      const rows = await repo.listAgents(tx, tenantId, "catalog");
      const find = (id: string) => {
        const r = rows.find((x) => x.id === id);
        return r && stateOf(r);
      };
      // Chuẩn hoá trước rồi mới kiểm: dự phòng chỉ giữ khi thật sự dùng (M2 · không ghi id chưa kiểm).
      const next = normalizeDefaults(body, find(body.default_agent_id)?.isOrchestrator ?? false);
      const problem = defaultsProblem(next, find);
      if (problem?.code === "NOT_ENTITLED")
        throw appError("NOT_ENTITLED", { agent_ids: [next[problem.field]] });
      if (problem) throw appError("INVALID_REFERENCE", { field: problem.field });
      const before = await repo.readDefaults(tx, tenantId);
      if (!(await repo.upsertDefaults(tx, tenantId, next, actor.userId)))
        return { hub_config_version: locked };
      const version = await bumpHubConfig(tx);
      const key = (id: string | null) => rows.find((r) => r.id === id)?.key ?? null;
      await this.d.audit.insert(tx, {
        ...(await this.auditBase(tx, actor, tenantId, version)),
        entity: "agent_default",
        action: "update",
        entityId: next.default_agent_id,
        entityName: key(next.default_agent_id) ?? next.default_agent_id,
        before: before && { ...before, default_key: key(before.default_agent_id) },
        after: { ...next, default_key: key(next.default_agent_id) },
      });
      await notifyHubConfig(tx, version);
      return { hub_config_version: version };
    });
  }

  putEntitlement(
    actor: AuthUser,
    tenantId: string,
    agentId: string,
    entitled: boolean,
  ): Promise<AgentSettingsWriteResponse> {
    // Bật/tắt agent cho công ty là quyền nền tảng (tenant_admin chỉ cấp quyền trong phạm vi đã bật).
    if (actor.role !== "platform_admin") throw appError("FORBIDDEN");
    return withHubScope(this.d.db, scopeOf(actor, tenantId), async (tx) => {
      await this.ensureTenant(tx, actor, tenantId);
      const locked = await lockHubConfig(tx);
      const rows = await repo.listAgents(tx, tenantId, "catalog");
      const agent = rows.find((r) => r.id === agentId);
      if (!agent) throw appError("INVALID_REFERENCE", { field: "agent_id" });
      if (!entitled && blocksDisable(agentId, await repo.readDefaults(tx, tenantId)))
        throw appError("AGENT_IS_DEFAULT");
      if (!(await repo.setEntitlement(tx, { tenantId, agentId, entitled, by: actor.userId })))
        return { hub_config_version: locked };
      const version = await bumpHubConfig(tx);
      await this.d.audit.insert(tx, {
        ...(await this.auditBase(tx, actor, tenantId, version)),
        entity: "agent_entitlement",
        action: entitled ? "enable" : "disable",
        entityId: agentId,
        entityName: agent.key,
        before: { entitled: agent.entitled },
        after: { entitled },
      });
      await notifyHubConfig(tx, version);
      return { hub_config_version: version };
    });
  }

  private async auditBase(tx: Tx, actor: AuthUser, tenantId: string, version: number) {
    return {
      tenantId,
      actorId: actor.userId,
      actorUsername: await repo.actorName(tx, actor.userId),
      actorRole: actor.role,
      hubConfigVersion: version,
      summary: {},
    };
  }
}
