// HUB-FR-79 · ADM-FR-37 · H3b-R12–R15 · GET `/agent-grants/effective/:user_id` (plan H3b §5.3 Effective, plan-db §4).
// Tính trên ẢNH CACHE (`ConfigCache`) bằng `effectiveAgents` — cùng điều kiện với menu `GET /agents` (R12, một sự thật).
// Cache được kéo theo kịp `hub_config_version` của DB trước khi tính (đọc ngay sau POST thấy grant — read-your-writes);
// DB chỉ đọc version (+ TENANT_EXISTS cho platform_admin) và GROUP_REFS. Chỉ đọc: không khoá, không audit (R15).
import { BETA_GROUP_KEY } from "@ai/contracts";
import {
  AGENT_GRANTS_AGENTS_MAX,
  type AgentAccessReason,
  type EffectiveAgent,
  type EffectiveAgentsResponse,
} from "@ai/contracts/hub-admin";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { ConfigSnapshot } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { type EffectiveAgentCalc, effectiveAgents } from "./agent-effective.rules";
import { currentVersion, type GroupRefRow, groupRefs, tenantExists } from "./agent-grants.repo";

const READ_ONLY = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

const scopeOf = (actor: AuthUser, tenantId: string): HubScope => ({
  kind: "user",
  tenantId,
  userId: actor.userId,
});

/** `grant_user`/`grant_tenant` (CR-054) trước, rồi `grant_group` theo `group.key`; group vắng ở `admin.groups` ⇒ bỏ (plan-db §4, không 500). */
function reasonsOf(c: EffectiveAgentCalc, groups: Map<string, GroupRefRow>): AgentAccessReason[] {
  const user: AgentAccessReason[] = [];
  const byGroup: GroupRefRow[] = [];
  for (const r of c.reasons) {
    if (r.code === "grant_user" || r.code === "grant_tenant") user.push({ code: r.code });
    else {
      const g = groups.get(r.groupId);
      if (g) byGroup.push(g);
    }
  }
  byGroup.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const group = byGroup.map(
    (g): AgentAccessReason => ({
      code: "grant_group",
      group: { id: g.id, key: g.key, name: g.name, is_beta: g.key === BETA_GROUP_KEY },
    }),
  );
  return [...user, ...group];
}

function toContract(
  calc: EffectiveAgentCalc[],
  snap: ConfigSnapshot,
  groups: Map<string, GroupRefRow>,
): EffectiveAgent[] {
  const names = new Map(snap.agents.map((a) => [a.id, a.name]));
  return calc.slice(0, AGENT_GRANTS_AGENTS_MAX).map((c) => ({
    agent: { id: c.agentId, key: c.key, name: names.get(c.agentId) ?? { vi: c.key, en: c.key } },
    visible: c.visible,
    reasons: reasonsOf(c, groups),
    missing: c.missing,
  }));
}

export class AgentEffectiveService {
  constructor(private readonly d: { db: Db; config: ConfigCache }) {}

  /** Cache chậm hơn DB (NOTIFY chưa tới) ⇒ nạp lại phần Hub rồi mới chụp ảnh. */
  private async freshSnapshot(dbVersion: number): Promise<ConfigSnapshot> {
    const snap = await this.d.config.snapshot();
    if (snap.version >= dbVersion) return snap;
    await this.d.config.reloadHub();
    return this.d.config.snapshot();
  }

  async effective(
    actor: AuthUser,
    tenantId: string,
    userId: string,
  ): Promise<EffectiveAgentsResponse> {
    const dbVersion = await withHubScope(
      this.d.db,
      scopeOf(actor, tenantId),
      async (tx) => {
        if (actor.role === "platform_admin" && !(await tenantExists(tx, tenantId)))
          throw appError("NOT_FOUND");
        return currentVersion(tx);
      },
      READ_ONLY,
    );
    const user = await this.d.config.user(userId);
    // R12/HUB-BR-14: user không có ≡ user tenant khác (404 giống hệt).
    if (!user || user.tenantId !== tenantId) throw appError("NOT_FOUND");
    const [snap, tenant] = await Promise.all([
      this.freshSnapshot(dbVersion),
      this.d.config.tenant(tenantId),
    ]);
    const calc = effectiveAgents({
      snapshot: snap,
      tenantId,
      tenantActive: tenant?.active ?? false,
      user,
    });
    const groupIds = [
      ...new Set(
        calc.flatMap((c) => c.reasons.flatMap((r) => ("groupId" in r ? [r.groupId] : []))),
      ),
    ];
    const rows = groupIds.length
      ? await withHubScope(
          this.d.db,
          scopeOf(actor, tenantId),
          (tx) => groupRefs(tx, tenantId, groupIds),
          READ_ONLY,
        )
      : [];
    return {
      user: { id: user.id, tenant_id: user.tenantId },
      agents: toContract(calc, snap, new Map(rows.map((g) => [g.id, g]))),
      hub_config_version: snap.version,
    };
  }
}
