// CR-122 · E1b · ADR-0038 · FLOW2-FR-05..09/20 · danh sách flow của công ty: xem, gán (platform_admin), bật/tắt, xếp thứ tự,
// xuất bản bản công ty (gốc tự Tắt), "Quay về bản gốc". Vai kiểm ở đây (`companyAccess`); mỗi thao tác MỘT tx scope
// system, khoá dòng `FOR UPDATE`. Chặn tắt flow không điều kiện cuối cùng của sự kiện `required` (FR-20 lưới cuối).
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError, appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import type { PackToolCatalog } from "../../packs/kit/public";
import { libraryFlowDef } from "../runs/runs.repo";
import { ensureFlowTriggersOn } from "../triggers/flags";
import * as r from "./company-flows.repo";
import { assertPlatformWrite, companyAccess } from "./library-company.service";
import { withConfigWrite } from "./routing.service";
import { notReadyError, type Readiness, readinessOf } from "./template-readiness";

const SYS = { kind: "system" as const };
const EVENTS = new Map(
  Object.values(APP_MANIFESTS).flatMap((m) => m.events.map((e) => [e.key, e] as const)),
);
const err = (code: string, status: 409 | 422, msg: string, details?: unknown) =>
  new AppError(code, status, msg, details);

function toRow(x: r.CfRow, shadowed: boolean): CompanyFlowRow {
  const company = x.def_tenant_id !== null;
  const src =
    x.src_key && x.src_name && x.src_version
      ? { flow_key: x.src_key, version: x.src_version, name: x.src_name }
      : null;
  const newer = x.src_published && x.src_version && x.src_published > x.src_version;
  return {
    id: x.id,
    flow_id: x.flow_id,
    flow_key: x.flow_key,
    name: x.name,
    app: x.app ?? "",
    kind: "company",
    trigger_event: x.is_start_form ? "" : (x.trigger_event ?? ""), // flow phiếu: bắt đầu bằng tay, không theo sự kiện
    has_condition: x.has_condition,
    enabled: x.enabled,
    position: x.position,
    replaced_by: x.replaced_by,
    off_reason: x.off_reason,
    source: src,
    rel_version: company
      ? x.off_reason === "not_published"
        ? null
        : x.version
      : x.published_version,
    library_newer: newer ? x.src_published : null,
    ...(x.updated_at ? { updated_at: new Date(x.updated_at).toISOString() } : {}),
    def_version: x.version,
    deletable: x.deletable,
    warnings: [
      ...(shadowed ? (["shadowed_by_unconditional"] as const) : []),
      ...(x.no_group ? (["group_missing"] as const) : []),
    ],
  };
}

/** Cảnh báo FR-20: sự kiện `decides`, flow đang bật đứng sau một flow đang bật KHÔNG điều kiện ⇒ không bao giờ chạy. */
export function toRows(rows: readonly r.CfRow[]): CompanyFlowRow[] {
  const blocked = new Set<string>();
  return rows.map((x) => {
    const ev = x.trigger_event && !x.is_start_form ? EVENTS.get(x.trigger_event) : undefined; // flow phiếu: không gây/nhận shadow
    const shadowed = !!ev?.decides && x.enabled && blocked.has(ev.key);
    if (ev && x.enabled && !x.has_condition) blocked.add(ev.key);
    return toRow(x, shadowed);
  });
}

export class CompanyFlowsService {
  constructor(
    private readonly db: Db,
    private readonly packTools?: PackToolCatalog,
  ) {}

  #tx<T>(u: AuthUser, tid: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    companyAccess(u, tid);
    return withHubScope(this.db, SYS, fn);
  }
  async #locked(tx: Tx, tid: string, id: string): Promise<r.CfRow> {
    const row = await r.lockCompanyFlow(tx, tid, id);
    if (!row) throw appError("NOT_FOUND");
    return row;
  }
  /** CR-127 · E8 · BR-10/11: mọi thao tác GHI chỉ quản trị nền tảng (quản trị công ty ⇒ 403 `FORBIDDEN_TENANT_ADMIN_WRITE`). */
  #wtx<T>(u: AuthUser, tid: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    assertPlatformWrite(u, tid);
    return withHubScope(this.db, SYS, fn);
  }
  #list = async (tx: Tx, tid: string) => ({ items: toRows(await r.listCompanyFlows(tx, tid)) });

  list(u: AuthUser, tid: string) {
    return this.#tx(u, tid, (tx) => this.#list(tx, tid));
  }

  /** Mẫu Thư viện này dùng được ở công ty chưa (thiếu gì, nhóm khớp ra sao) — platform xem trước khi gán, công ty xem trước khi sao chép. */
  readiness(u: AuthUser, tid: string, flowId: string): Promise<Readiness> {
    return this.#tx(u, tid, async (tx) => {
      const lib = await libraryFlowDef(tx, flowId);
      if (!lib) throw appError("NOT_FOUND");
      return readinessOf(tx, tid, lib.stages, this.packTools);
    });
  }

  setEnabled(u: AuthUser, tid: string, id: string, enabled: boolean) {
    return this.#wtx(u, tid, async (tx) => {
      const row = enabled
        ? await this.#lockForEnable(tx, tid, id)
        : await this.#locked(tx, tid, id);
      if (!enabled) await this.#guardRequired(tx, tid, row);
      await r.setFlowState(tx, {
        tid,
        id,
        enabled,
        offReason: enabled ? null : "turned_off",
        replacedBy: enabled ? null : row.replaced_by,
        actor: u.userId,
      });
      return this.#list(tx, tid);
    });
  }

  reorder(u: AuthUser, tid: string, ids: readonly string[]) {
    return this.#wtx(u, tid, async (tx) => {
      await tx.execute(
        sql`select 1 from hub.company_flows where tenant_id = ${tid}::uuid for update`,
      );
      const all = await r.listCompanyFlows(tx, tid);
      const same =
        ids.length === all.length &&
        new Set(ids).size === ids.length &&
        all.every((x) => ids.includes(x.id));
      if (!same)
        throw err(
          "FLOW_ORDER_INVALID",
          422,
          "Thứ tự phải gồm đủ mọi quy trình của công ty, mỗi quy trình một lần.",
        );
      await r.reorderCompanyFlows(tx, tid, ids, u.userId);
      return this.#list(tx, tid);
    });
  }

  /** Xuất bản bản công ty theo id dòng (đường cũ, UI không còn gọi — "Lưu và áp dụng" dùng `apply`). Cùng `#activate`. */
  publish(u: AuthUser, tid: string, id: string) {
    return this.#wtx(u, tid, async (tx) => {
      await this.#activate(tx, u, tid, await this.#locked(tx, tid, id));
      return this.#list(tx, tid);
    });
  }

  /**
   * CR-123 FLOW3-FR-10 · "Lưu và áp dụng" (bước áp dụng, sau khi editor lưu def): theo id def của công ty ⇒ bản đó thành flow đang dùng
   * của sự kiện, thay bản gốc Thư viện (nếu có) — MỘT tx, số câu SQL cố định. Hợp đồng đang chờ giữ bản cũ (đã gắn def lúc gửi).
   * Def tự tạo chưa có dòng ⇒ tạo dòng Bật. Chặn khi còn bước duyệt chưa chọn nhóm.
   */
  async apply(u: AuthUser, tid: string, flowId: string) {
    assertPlatformWrite(u, tid);
    // withConfigWrite: cùng tx ghi audit `company_flow.apply` + tăng phiên cấu hình (Hub nạp lại ngay, không chờ định kỳ)
    const w = await withConfigWrite({ db: this.db, audit: dbHubAudit }, u, async (tx) => {
      let id = await r.rowIdOfFlow(tx, tid, flowId);
      if (!id) {
        if (!(await r.assignableDef(tx, tid, flowId)))
          throw err(
            "FLOW_NOT_ASSIGNABLE",
            422,
            "Quy trình chưa có Bắt đầu khi — chọn sự kiện bắt đầu rồi áp dụng lại.",
          );
        id = await r.insertCompanyFlow(tx, {
          tid,
          flowId,
          enabled: false,
          offReason: "not_published",
          actor: u.userId,
        });
      }
      const row = await this.#locked(tx, tid, id);
      if (row.no_group)
        throw err(
          "FLOW_GROUP_MISSING",
          422,
          "Còn bước duyệt chưa chọn nhóm. Chọn nhóm cho mọi bước duyệt rồi áp dụng lại.",
        );
      await this.#activate(tx, u, tid, row);
      return {
        result: { id, ...(await this.#list(tx, tid)) },
        audit: {
          tenantId: tid,
          action: "update",
          entity: "process_def",
          entityId: flowId,
          entityName: "company_flow.apply",
          before: { enabled: row.enabled },
          after: { enabled: true, flow_triggers: true },
          summary: {
            op: "company_flow.apply",
            tenant_id: tid,
            flow_id: flowId,
          },
        },
      };
    });
    return w.result;
  }

  /** Quy trình công ty ⇒ Bật (CR-127 Z7: không còn "bản gốc Thư viện" để thay — chỉ bật dòng này) — một tx. */
  async #activate(tx: Tx, u: AuthUser, tid: string, row: r.CfRow): Promise<void> {
    await r.setFlowState(tx, {
      tid,
      id: row.id,
      enabled: true,
      offReason: null,
      replacedBy: null,
      actor: u.userId,
    });
    await ensureFlowTriggersOn(tx, tid); // CR-125 · c2: áp dụng xong là dùng — cùng tx, không cần bật công tắc riêng
  }

  /** Bật một dòng: quy trình "chưa xuất bản" (nháp) phải qua "Lưu và áp dụng" ở trình sửa, không PATCH bật được. */
  async #lockForEnable(tx: Tx, tid: string, id: string): Promise<r.CfRow> {
    const row = await this.#locked(tx, tid, id);
    if (row.off_reason === "not_published")
      throw err(
        "FLOW_NOT_PUBLISHED",
        409,
        "Quy trình chưa áp dụng. Mở quy trình, sửa rồi bấm Lưu và áp dụng.",
      );
    return row;
  }

  async #guardRequired(tx: Tx, tid: string, row: r.CfRow): Promise<void> {
    const ev = row.trigger_event ? EVENTS.get(row.trigger_event) : undefined;
    if (!ev?.required || !row.enabled || row.has_condition || row.is_start_form) return;
    if ((await r.unconditionalOn(tx, tid, ev.key, row.id)) > 0) return;
    throw err(
      "FLOW_REQUIRED_LAST",
      409,
      `"${ev.label}" cần ít nhất một quy trình đang bật không điều kiện. Bật hoặc thêm quy trình khác trước khi tắt quy trình này.`,
    );
  }
}
