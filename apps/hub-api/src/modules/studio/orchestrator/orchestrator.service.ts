// HUB-FR-62 · HUB-FR-69 · H4a-R07, R08, R09 · plan §5.3 · nghiệp vụ Orchestrator Studio (mặc định + theo tenant).
// Ghi qua `withConfigWrite` (khoá `config_meta` → hàng `orchestrator_settings` FOR UPDATE — plan §7). Đọc: một transaction
// REPEATABLE READ read only scope `system` (P6).
import type {
  AgentRuntime,
  Orchestrator,
  OrchestratorInput,
  OrchestratorList,
  OrchestratorWriteResponse,
} from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { readHubVersion } from "../studio-read.repo";
import { type StudioAudit, type StudioWriteDeps, withConfigWrite } from "../studio-write";
import {
  orchChangedFields,
  orchEntityName,
  orchSnapshot,
  orchVersionConflict,
  toOrchestrator,
} from "./orchestrator.map";
import {
  deleteOrch,
  insertTenantOrch,
  listTenantOrchs,
  type OrchDbRow,
  type OrchFields,
  readAgentBrief,
  readOrch,
  readTenant,
  updateOrch,
} from "./orchestrator.repo";
import { orchestratorAgentProblem, tenantOrchestratorProblem } from "./orchestrator-settings.rules";

const fieldsOf = (b: OrchestratorInput): OrchFields => ({
  agentId: b.agent_id,
  maxSteps: b.max_steps,
  tokenBudget: b.token_budget,
  historyN: b.history_n,
  onNoMatch: b.on_no_match,
});

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** R07/QB1: vắng ⇒ 400 `INVALID_REFERENCE{agent_id}`; tắt / runtime ∉ `ORCHESTRATOR_RUNTIMES` ⇒ 409. */
async function checkAgent(tx: Tx, agentId: string): Promise<void> {
  const a = await readAgentBrief(tx, agentId);
  const p = orchestratorAgentProblem(
    a && { enabled: a.enabled, runtime: a.runtime as AgentRuntime },
  );
  if (p === "not_found") throw appError("INVALID_REFERENCE", { field: "agent_id", reason: p });
  if (p) throw appError("AGENT_NOT_ORCHESTRATABLE", { reason: p });
}

/** R09: version lệch ⇒ 409 `VERSION_CONFLICT{current, updated_at}`. */
function checkVersion(row: OrchDbRow, version: number): void {
  if (row.version !== version) throw appError("VERSION_CONFLICT", orchVersionConflict(row));
}

async function reread(tx: Tx, tenantId: string | null): Promise<Orchestrator> {
  const row = await readOrch(tx, tenantId);
  if (!row) throw new Error("orchestrator_settings vắng sau ghi");
  return toOrchestrator(row);
}

function audit(
  action: "create" | "update" | "delete",
  before: Orchestrator | null,
  after: Orchestrator | null,
): StudioAudit {
  const o = (after ?? before) as Orchestrator;
  return {
    tenantId: o.tenant?.id ?? null,
    action,
    entity: "orchestrator",
    entityId: null,
    entityName: orchEntityName(o),
    before: before && orchSnapshot(before),
    after: after && orchSnapshot(after),
    summary: { fields: after ? orchChangedFields(before, after) : [] },
  };
}

export class OrchestratorService {
  constructor(private readonly d: StudioWriteDeps) {}

  /** GET · thiếu bản mặc định ⇒ 500 (như `orchestratorProblem`). */
  list(): Promise<OrchestratorList> {
    return withHubScope(
      this.d.db,
      { kind: "system" },
      async (tx) => {
        const def = await readOrch(tx, null);
        if (!def) throw new Error("orchestrator_settings mặc định vắng");
        return {
          default: toOrchestrator(def),
          tenants: (await listTenantOrchs(tx)).map(toOrchestrator),
          hub_config_version: await readHubVersion(tx),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  /** PUT default · khoá hàng → version → agent → UPDATE → audit `update` (tenant null). */
  async putDefault(
    actor: AuthUser,
    b: OrchestratorInput & { version: number },
  ): Promise<OrchestratorWriteResponse> {
    return this.#update(actor, null, b);
  }

  /** PUT tenant · vắng bản ⇒ 404 → version → tenant khoá ⇒ `TENANT_INACTIVE` → agent → UPDATE → audit. */
  async putTenant(
    actor: AuthUser,
    tenantId: string,
    b: OrchestratorInput & { version: number },
  ): Promise<OrchestratorWriteResponse> {
    return this.#update(actor, tenantId, b);
  }

  async #update(
    actor: AuthUser,
    tenantId: string | null,
    b: OrchestratorInput & { version: number },
  ): Promise<OrchestratorWriteResponse> {
    const { result, version } = await withConfigWrite(this.d, actor, async (tx) => {
      const row = await readOrch(tx, tenantId, true);
      if (!row) {
        if (tenantId === null) throw new Error("orchestrator_settings mặc định vắng");
        throw appError("NOT_FOUND");
      }
      checkVersion(row, b.version);
      if (tenantId !== null && !(await readTenant(tx, tenantId))?.active)
        throw appError("TENANT_INACTIVE");
      await checkAgent(tx, b.agent_id);
      await updateOrch(tx, row.id, fieldsOf(b), actor.userId);
      const before = toOrchestrator(row);
      const after = await reread(tx, tenantId);
      return { result: after, audit: audit("update", before, after) };
    });
    return { orchestrator: result, hub_config_version: version };
  }

  /** POST tenant · 201 · tenant → đã có bản → agent → INSERT (23505 ⇒ `ORCHESTRATOR_EXISTS`) → audit `create`. */
  async createTenant(
    actor: AuthUser,
    b: OrchestratorInput & { tenant_id: string },
  ): Promise<OrchestratorWriteResponse> {
    const { result, version } = await withConfigWrite(this.d, actor, async (tx) => {
      const t = await readTenant(tx, b.tenant_id);
      const exists = (await readOrch(tx, b.tenant_id)) !== undefined;
      const p = tenantOrchestratorProblem(t, exists);
      if (p === "not_found") throw appError("INVALID_REFERENCE", { field: "tenant_id", reason: p });
      if (p === "inactive") throw appError("TENANT_INACTIVE");
      if (p === "exists") throw appError("ORCHESTRATOR_EXISTS");
      await checkAgent(tx, b.agent_id);
      await insertTenantOrch(tx, b.tenant_id, fieldsOf(b), actor.userId).catch((err: unknown) => {
        throw isUniqueViolation(err) ? appError("ORCHESTRATOR_EXISTS") : err;
      });
      const after = await reread(tx, b.tenant_id);
      return { result: after, audit: audit("create", null, after) };
    });
    return { orchestrator: result, hub_config_version: version };
  }

  /** DELETE tenant · 204 · khoá hàng (vắng ⇒ 404) → version → DELETE → audit `delete` (tenant khoá vẫn xoá được). */
  async deleteTenant(actor: AuthUser, tenantId: string, v: number): Promise<void> {
    await withConfigWrite(this.d, actor, async (tx) => {
      const row = await readOrch(tx, tenantId, true);
      if (!row) throw appError("NOT_FOUND");
      checkVersion(row, v);
      await deleteOrch(tx, row.id);
      return { result: null, audit: audit("delete", toOrchestrator(row), null) };
    });
  }
}
