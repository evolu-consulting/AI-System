// dlc-dify · `POST /dify/agents/spawn`: sau khi user DUYỆT plan, flow DLC sinh các agent theo domain (dev) và theo domain
// QC từ một agent mẫu (vd `dlc-build`, `dlc-qc`): cùng profile/tool/hook/persona, lời nhắc hệ thống = mẫu + phần chuyên
// môn của domain. Key `dlc-<project>-<domain>` (đã có ⇒ cập nhật phần chuyên môn). Bật cho tenant + cấp quyền user cầm vé.
// Ghi qua đúng service của Studio (`AgentsService`, entitlement, grant) ⇒ audit + bump cấu hình như thao tác tay.
import type { Agent, AgentCreate } from "@ai/contracts/studio";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { AgentGrantsService } from "../agent-grants/agent-grants.service";
import type { AgentHooksService } from "../agent-hooks/hooks.service";
import type { AgentsService } from "../studio/agents/agents.service";
import type { EntitlementsService } from "../studio/entitlements/entitlements.service";
import type { FlowTickets } from "./tickets";

export type SpawnRequest = {
  project: string;
  template: string;
  agents: { domain: string; name: string; focus: string }[];
};
export type Spawned = { key: string; id: string; created: boolean };

const keyOf = (project: string, domain: string) =>
  `dlc-${project}-${domain}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "")
    .slice(0, 48);

const MARK = "\n\n## Your domain in this project\n";

type SpawnCtx = { actor: AuthUser; tenantId: string; tpl: Agent; project: string };

/** Cấu hình agent domain: mọi thứ của mẫu, lời nhắc = phần chung của mẫu + chuyên môn domain. */
function agentFields(tpl: Agent, project: string, a: SpawnRequest["agents"][number]) {
  const domain = `Project: ${project}. Domain: ${a.domain}.\n${a.focus}`;
  const prompt = `${tpl.system_prompt.split(MARK)[0]}${MARK}${domain}`.slice(0, 20_000);
  const desc =
    `${a.name} — agent DLC sinh từ plan (project ${project}, domain ${a.domain}; mẫu ${tpl.key}).`.slice(
      0,
      400,
    );
  return {
    name: { vi: a.name.slice(0, 80), en: a.name.slice(0, 80) },
    description: desc.length >= 20 ? desc : `${desc} (DLC)`,
    system_prompt: prompt,
    timeout_s: tpl.timeout_s,
    token_budget: tpl.token_budget,
    enabled: true,
    profile_id: tpl.profile_id,
    model: tpl.model ?? null,
    runtime_options: tpl.runtime_options,
    workflow_ids: tpl.workflow_ids,
  };
}

export class SpawnService {
  constructor(
    private readonly d: {
      db: Db;
      tickets: FlowTickets;
      agents: AgentsService;
      hooks: AgentHooksService;
      entitlements: EntitlementsService;
      grants: AgentGrantsService;
      log: Logger;
    },
  ) {}

  async #byKey(key: string): Promise<Agent | null> {
    const [r] = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      tx.execute<{ id: string }>(sql`select id from hub.agents where key = ${key}`),
    );
    return r ? this.d.agents.get(r.id) : null;
  }

  /** Tạo / cập nhật MỘT agent domain từ mẫu, gắn hook của mẫu, bật cho tenant, cấp quyền user cầm vé. */
  async #spawnOne(x: SpawnCtx, a: SpawnRequest["agents"][number]): Promise<Spawned> {
    const key = keyOf(x.project, a.domain);
    const cur = await this.#byKey(key);
    const common = agentFields(x.tpl, x.project, a);
    const res = cur
      ? await this.d.agents.update(x.actor, cur.id, { ...common, version: cur.version } as never)
      : await this.d.agents.create(x.actor, {
          runtime: "agentic-cli",
          key,
          ...common,
        } as AgentCreate);
    const id = res.agent.id;
    if (x.tpl.hooks?.length)
      await this.d.hooks.setHooks(x.actor, id, { hooks: x.tpl.hooks, version: res.agent.version });
    await this.d.entitlements.set(x.actor, id, x.tenantId, true);
    await this.d.grants
      .grant(x.actor, x.tenantId, { agentId: id, subjectType: "user", subjectId: x.actor.userId })
      .catch(() => {});
    return { key, id, created: !cur };
  }

  async spawn(ticket: string, b: SpawnRequest): Promise<{ agents: Spawned[] }> {
    const t = await this.d.tickets.resolve(ticket);
    if (!t) throw appError("AUTH_EXPIRED");
    // Hub làm thay user theo vé flow (quyền ghi cấu hình agent DLC) — audit ghi đúng user.
    const actor: AuthUser = { userId: t.userId, tenantId: t.tenantId, role: "platform_admin" };
    const tpl = await this.#byKey(b.template);
    if (tpl?.runtime !== "agentic-cli" || !tpl.profile_id) throw appError("AGENT_NOT_FOUND");
    const x: SpawnCtx = { actor, tenantId: t.tenantId, tpl, project: b.project };
    const out: Spawned[] = [];
    for (const a of b.agents.slice(0, 12)) out.push(await this.#spawnOne(x, a));
    this.d.log.info("dlc-agents-spawned", {
      tenant_id: t.tenantId,
      user_id: t.userId,
      n: out.length,
    });
    return { agents: out };
  }
}
