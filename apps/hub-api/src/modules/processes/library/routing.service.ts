// CR-118 §11.2 · nghiệp vụ tập quy trình đã gán + luật chọn quy trình. Cổng vai ở route; ở đây chốt tenant: tenant_admin CHỈ
// tenant của mình (khác ⇒ 404, không lộ tồn tại), ghi trong scope `user` của tenant đích (RLS thêm một lớp); platform_admin scope
// system. Mọi ghi qua `withConfigWrite` (khoá `config_meta` ⇒ ghi tuần tự; bump `hub_config_version` + NOTIFY ⇒ `config.changed`;
// audit trước/sau). PUT luật: thay cả danh sách trong MỘT tx, `version` lệch ⇒ 409.
import {
  HUB_ADMIN_ROUTING_ERRORS,
  type HubAdminRoutingErrorCode,
  type ProcessRouting,
  type ProcessRoutingDefView,
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

/** Cùng đường ghi cấu hình + audit cho các service trong thư mục (ADR-0037: một điểm chạm sang `studio`). */
export { withConfigWrite };

import { slotActive } from "./routing-active.rules";
import { deleteAssignment, upsertAssignment } from "./slot-assign.repo";

const MESSAGES: Record<HubAdminRoutingErrorCode, string> = {
  ROUTING_PROCESS_NOT_ASSIGNED: "Process is not assigned to the tenant",
  ROUTING_DEPARTMENT_INVALID: "Department does not belong to the tenant",
  ROUTING_RULES_INVALID: "Invalid routing rules",
  ROUTING_PROCESS_IN_USE: "Process is used by routing rules",
  ROUTING_PROCESS_UNAVAILABLE: "Process is deleted or not published",
};

/** cr118-routing-deleted · `live` = tập gán còn sống (def chưa xoá) ⇒ rel_version; vắng ⇒ deleted, null ⇒ unpublished. */
function unavailableOf(
  live: ReadonlyMap<string, number | null>,
  defId: string,
): { unavailable?: "deleted" | "unpublished" } {
  if (!live.has(defId)) return { unavailable: "deleted" };
  return live.get(defId) == null ? { unavailable: "unpublished" } : {};
}
export const routingError = (
  code: HubAdminRoutingErrorCode,
  details?: unknown,
  message?: string,
): AppError =>
  new AppError(code, HUB_ADMIN_ROUTING_ERRORS[code], message ?? MESSAGES[code], details);

// Thông điệp 409 bỏ gán: nói cách sửa (Luật GỐC 3); UI hiển thị bản i18n vi/en `tenants.slots.routing.err.inUse` theo mã lỗi.
const IN_USE_DEFAULT_MSG =
  "Quy trình này đang là mặc định của việc — hãy gán quy trình khác làm mặc định trước rồi bỏ gán.";
const IN_USE_RULES_MSG =
  "Quy trình này đang được luật chọn quy trình dùng — hãy sửa hoặc xoá các luật đó rồi bỏ gán.";

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

/** Hình luật: luật thường cần ≥ 1 điều kiện không rỗng (phòng ban và/hoặc loại HĐ — cr118-route-kind); ≤ 1 mặc định (điều kiện
 *  của mặc định bỏ qua ⇒ lưu `{}`). Điều kiện rỗng không lưu (luật chỉ phòng ban giữ đúng hình `{departmentIds}` cũ). */
function normalize(b: PutProcessRoutingRequest): rt.RuleWrite[] {
  if (b.rules.filter((r) => r.is_default).length > 1)
    throw routingError("ROUTING_RULES_INVALID", { reason: "multiple_defaults" });
  return b.rules.map((r, i) => {
    const depts = [...new Set(r.condition.departmentIds ?? [])];
    const kinds = [...new Set(r.condition.contractKinds ?? [])];
    if (!r.is_default && depts.length === 0 && kinds.length === 0)
      throw routingError("ROUTING_RULES_INVALID", { reason: "no_condition", index: i });
    const cond = {
      ...(depts.length ? { departmentIds: depts } : {}),
      ...(kinds.length ? { contractKinds: kinds } : {}),
    };
    return {
      condition: r.is_default ? {} : cond,
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

  /** Sơ đồ một quy trình trong tập gán (flow-canvas chế độ xem). Tenant khác / def ∉ tập ⇒ 404. Một câu SQL. */
  async def(
    u: AuthUser,
    tenantId: string,
    slot: string,
    defId: string,
  ): Promise<ProcessRoutingDefView> {
    scopeFor(u, tenantId);
    specOrThrow(slot);
    // cr118-routing-deleted · chỉ platform_admin xem được nháp (def chưa xuất bản); def đã xoá ⇒ 404 cho mọi vai.
    const draft = u.role === "platform_admin";
    const r = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      rt.assignedDef(tx, { tenantId, slot, defId, draft }),
    );
    if (!r) throw appError("NOT_FOUND");
    return {
      def_id: r.def_id,
      slot,
      name: r.name,
      rel_version: r.rel_version === null ? null : Number(r.rel_version),
      stages: r.stages ?? [],
      slot_body: r.slot_body,
    };
  }

  #view(tenantId: string, slot: string): Promise<ProcessRouting> {
    return withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const [{ version, rules }, processes, current] = [
        await rt.readRouting(tx, tenantId, slot),
        await rt.assignedOf(tx, tenantId, slot),
        await rt.currentOf(tx, tenantId, slot),
      ];
      const live = new Map(processes.map((p) => [p.def_id, p.rel_version]));
      return {
        slot,
        version,
        rules: rules.map((r) => ({
          id: r.id,
          priority: Number(r.priority),
          condition: r.condition,
          def_id: r.def_id,
          is_default: r.is_default === true,
          ...unavailableOf(live, r.def_id),
        })),
        processes: processes.map((p) => ({
          def_id: p.def_id,
          name: p.name,
          rel_version: p.rel_version === null ? null : Number(p.rel_version),
        })),
        current_def_id: current?.def_id ?? null,
        current_def_name: current?.name ?? null,
        active: slotActive(specOrThrow(slot).optIn === true, rules.length, processes.length),
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
    await this.#usable(tenantId, slot, rules);
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

  /** cr118-routing-deleted · def trong tập gán nhưng đã xoá / chưa xuất bản ⇒ 422 `ROUTING_PROCESS_UNAVAILABLE` (đọc `process_defs`
   *  thư viện cần scope system ⇒ kiểm trước tx ghi; def ngoài tập để `#validate` trả `ROUTING_PROCESS_NOT_ASSIGNED`). Hai câu. */
  async #usable(tenantId: string, slot: string, rules: readonly rt.RuleWrite[]) {
    if (rules.length === 0) return;
    const [ids, live] = await withHubScope(this.d.db, { kind: "system" }, async (tx) => [
      await rt.assignedIds(tx, tenantId, slot),
      new Map((await rt.assignedOf(tx, tenantId, slot)).map((p) => [p.def_id, p.rel_version])),
    ]);
    for (const r of rules) {
      const why = ids.has(r.defId) ? unavailableOf(live, r.defId).unavailable : undefined;
      if (why) throw routingError("ROUTING_PROCESS_UNAVAILABLE", { def_id: r.defId, reason: why });
    }
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

  /**
   * platform_admin · gán quy trình đã xuất bản của khe cho tenant: CÙNG một tx vào tập gán + đặt luật MẶC ĐỊNH của khe = quy trình
   * này với `source = 'admin'` (một đường — `upsertAssignment`; cổng engine đọc đúng luật này) ⇒ gán xong là chạy, không thao tác
   * ẩn (CR-121 F-1). Gán quy trình khác ⇒ luật mặc định đổi theo (luật theo phòng ban/loại HĐ giữ nguyên). Đã là mặc định do
   * admin đặt ⇒ không đổi, không bump.
   */
  async assign(
    u: AuthUser,
    tenantId: string,
    slot: string,
    defId: string,
  ): Promise<ProcessRouting> {
    await withConfigWrite(this.#w, u, async (tx) => {
      await this.lib.assignable(tx, tenantId, slot, defId);
      const cur = await rt.defaultRuleOf(tx, tenantId, slot);
      if (cur?.def_id === defId && cur.source === "admin") return { result: null, audit: null };
      const prev = await upsertAssignment(tx, { tenantId, slot, defId, actorId: u.userId });
      const a = audit("assign_process", {
        tenantId,
        slot,
        defId,
        before: { default_def_id: prev },
        after: { slot, default_def_id: defId },
      });
      return { result: null, audit: a };
    });
    return this.#view(tenantId, slot);
  }

  /**
   * platform_admin · bỏ gán; luật đang dùng ⇒ 409 `ROUTING_PROCESS_IN_USE` kèm danh sách luật + câu cách sửa. Không có ⇒ 204 không đổi.
   * Khe opt-in (vd duyệt bài Community): "gán" chính là bật khe ⇒ quy trình chỉ còn được dùng bởi luật mặc định thì bỏ gán = tắt khe
   * (xoá luôn luật mặc định cùng tx, CR-121 F-1); khe thường luôn cần một mặc định ⇒ phải gán quy trình khác trước.
   */
  async unassign(u: AuthUser, tenantId: string, slot: string, defId: string): Promise<void> {
    const optIn = specOrThrow(slot).optIn === true;
    await withConfigWrite(this.#w, u, async (tx) => {
      const used = await rt.rulesUsing(tx, tenantId, slot, defId);
      const dflt = used.length ? await rt.defaultRuleOf(tx, tenantId, slot) : null;
      const isDefault = dflt?.def_id === defId;
      const turnOff = optIn && isDefault && used.length === 1;
      if (used.length && !turnOff)
        throw routingError(
          "ROUTING_PROCESS_IN_USE",
          { rules: used.map((r) => ({ id: r.id, priority: Number(r.priority) })) },
          isDefault ? IN_USE_DEFAULT_MSG : IN_USE_RULES_MSG,
        );
      if (turnOff) await deleteAssignment(tx, tenantId, slot);
      if (!(await rt.deleteAssigned(tx, tenantId, slot, defId)))
        return { result: null, audit: null };
      const a = audit("unassign_process", {
        tenantId,
        slot,
        defId,
        before: { slot },
        after: turnOff ? { slot_off: true } : {},
      });
      return { result: null, audit: a };
    });
  }
}
