// CR-118 §11.2 · nghiệp vụ tập quy trình đã gán + luật chọn quy trình. Cổng vai ở route; ở đây chốt tenant: tenant_admin CHỈ
// tenant của mình (khác ⇒ 404, không lộ tồn tại), ghi trong scope `user` của tenant đích (RLS thêm một lớp); platform_admin scope
// system. Mọi ghi qua `withConfigWrite` (khoá `config_meta` ⇒ ghi tuần tự; bump `hub_config_version` + NOTIFY ⇒ `config.changed`;
// audit trước/sau). PUT luật: thay cả danh sách trong MỘT tx, `version` lệch ⇒ 409.
import {
  HUB_ADMIN_ROUTING_ERRORS,
  type HubAdminRoutingErrorCode,
  type ProcessRouting,
  type PutProcessRoutingRequest,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import type { HubScope } from "@ai/db/hub-scope";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError, appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import { type StudioAudit, withConfigWrite } from "../../studio/studio-write";
import type { ProcessDeps } from "../core/ports";
import type { LibraryService } from "./library.service";
import { specOrThrow } from "./library-draft";
import * as rt from "./routing.repo";

const MESSAGES: Record<HubAdminRoutingErrorCode, string> = {
  ROUTING_PROCESS_NOT_ASSIGNED: "Process is not assigned to the tenant",
  ROUTING_DEPARTMENT_INVALID: "Department does not belong to the tenant",
  ROUTING_RULES_INVALID: "Invalid routing rules",
  ROUTING_PROCESS_IN_USE: "Process is used by routing rules",
};
export const routingError = (code: HubAdminRoutingErrorCode, details?: unknown): AppError =>
  new AppError(code, HUB_ADMIN_ROUTING_ERRORS[code], MESSAGES[code], details);

type Act = "assign_process" | "unassign_process" | "set_routing";
const audit = (
  action: Act,
  o: { tenantId: string; slot: string; defId?: string | null; before: unknown; after: unknown },
): StudioAudit => ({
  tenantId: o.tenantId,
  action,
  entity: "process_def",
  entityId: o.defId ?? null,
  entityName: o.slot,
  before: o.before as Record<string, unknown>,
  after: o.after as Record<string, unknown>,
  summary: { slot: o.slot, ...(o.defId ? { def_id: o.defId } : {}) },
});

/** tenant_admin chỉ tenant của mình (khác ⇒ 404); platform_admin mọi tenant. Trả scope ghi. */
function scopeFor(u: AuthUser, tenantId: string): HubScope {
  if (u.role === "platform_admin") return { kind: "system" };
  if (u.role === "tenant_admin" && u.tenantId === tenantId)
    return { kind: "user", tenantId, userId: u.userId };
  throw appError(u.role === "tenant_admin" ? "NOT_FOUND" : "FORBIDDEN");
}

/** Hình luật: luật thường cần ≥ 1 phòng ban; ≤ 1 mặc định (điều kiện của mặc định bỏ qua ⇒ lưu `{}`). */
function normalize(b: PutProcessRoutingRequest): rt.RuleWrite[] {
  if (b.rules.filter((r) => r.is_default).length > 1)
    throw routingError("ROUTING_RULES_INVALID", { reason: "multiple_defaults" });
  return b.rules.map((r, i) => {
    const depts = [...new Set(r.condition.departmentIds ?? [])];
    if (!r.is_default && depts.length === 0)
      throw routingError("ROUTING_RULES_INVALID", { reason: "no_departments", index: i });
    return {
      condition: r.is_default ? {} : { departmentIds: depts },
      defId: r.def_id,
      isDefault: r.is_default,
    };
  });
}

export class RoutingService {
  readonly #w;
  constructor(
    private readonly d: Pick<ProcessDeps, "db">,
    private readonly lib: LibraryService,
  ) {
    this.#w = { db: d.db, audit: dbHubAudit };
  }

  /** Đọc (scope system, lọc tenant tường minh — sau khi đã chốt quyền theo tenant). */
  async get(u: AuthUser, tenantId: string, slot: string): Promise<ProcessRouting> {
    scopeFor(u, tenantId);
    specOrThrow(slot);
    return this.#view(tenantId, slot);
  }

  #view(tenantId: string, slot: string): Promise<ProcessRouting> {
    return withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const [{ version, rules }, processes] = [
        await rt.readRouting(tx, tenantId, slot),
        await rt.assignedOf(tx, tenantId, slot),
      ];
      return {
        slot,
        version,
        rules: rules.map((r) => ({
          id: r.id,
          priority: Number(r.priority),
          condition: r.condition,
          def_id: r.def_id,
          is_default: r.is_default === true,
        })),
        processes: processes.map((p) => ({
          def_id: p.def_id,
          name: p.name,
          rel_version: p.rel_version === null ? null : Number(p.rel_version),
        })),
      };
    });
  }

  async put(
    u: AuthUser,
    tenantId: string,
    slot: string,
    b: PutProcessRoutingRequest,
  ): Promise<ProcessRouting> {
    const scope = scopeFor(u, tenantId);
    specOrThrow(slot);
    const rules = normalize(b);
    await withConfigWrite(
      this.#w,
      u,
      async (tx) => {
        const cur = await rt.readRouting(tx, tenantId, slot, true);
        if (cur.version !== b.version)
          throw appError("VERSION_CONFLICT", { current_version: cur.version });
        await this.#validate(tx, tenantId, slot, rules);
        const version = await rt.replaceRules(tx, { tenantId, slot, actorId: u.userId, rules });
        const after = { version, rules: rules.map((r) => ({ ...r })) };
        const before = { version: cur.version, rules: cur.rules };
        return { result: null, audit: audit("set_routing", { tenantId, slot, before, after }) };
      },
      scope,
    );
    return this.#view(tenantId, slot);
  }

  async #validate(tx: Tx, tenantId: string, slot: string, rules: readonly rt.RuleWrite[]) {
    const assigned = await rt.assignedIds(tx, tenantId, slot);
    const bad = rules.find((r) => !assigned.has(r.defId));
    if (bad) throw routingError("ROUTING_PROCESS_NOT_ASSIGNED", { def_id: bad.defId });
    const ids = [...new Set(rules.flatMap((r) => (r.condition.departmentIds as string[]) ?? []))];
    const outside = await rt.deptsOutside(tx, tenantId, ids);
    if (outside.length)
      throw routingError("ROUTING_DEPARTMENT_INVALID", { department_ids: outside.slice(0, 20) });
  }

  /** platform_admin · gán quy trình đã xuất bản của khe vào tập của tenant (đã có ⇒ không đổi, không bump). */
  async assign(
    u: AuthUser,
    tenantId: string,
    slot: string,
    defId: string,
  ): Promise<ProcessRouting> {
    await withConfigWrite(this.#w, u, async (tx) => {
      await this.lib.assignable(tx, tenantId, slot, defId);
      const added = await rt.insertAssigned(tx, { tenantId, slot, defId, actorId: u.userId });
      if (!added) return { result: null, audit: null };
      const a = audit("assign_process", { tenantId, slot, defId, before: null, after: { slot } });
      return { result: null, audit: a };
    });
    return this.#view(tenantId, slot);
  }

  /** platform_admin · bỏ gán; luật đang dùng ⇒ 409 `ROUTING_PROCESS_IN_USE` kèm danh sách luật. Không có ⇒ 204 không đổi. */
  async unassign(u: AuthUser, tenantId: string, slot: string, defId: string): Promise<void> {
    specOrThrow(slot);
    await withConfigWrite(this.#w, u, async (tx) => {
      const used = await rt.rulesUsing(tx, tenantId, slot, defId);
      if (used.length)
        throw routingError("ROUTING_PROCESS_IN_USE", {
          rules: used.map((r) => ({ id: r.id, priority: Number(r.priority) })),
        });
      if (!(await rt.deleteAssigned(tx, tenantId, slot, defId)))
        return { result: null, audit: null };
      const a = audit("unassign_process", { tenantId, slot, defId, before: { slot }, after: {} });
      return { result: null, audit: a };
    });
  }
}
