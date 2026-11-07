// CR-122 · E1b · ADR-0038 · FLOW2-FR-05..09/20 · danh sách flow của công ty: xem, gán (platform_admin), bật/tắt, xếp thứ tự,
// "Sao chép để sửa", xuất bản bản sao (gốc tự Tắt), "Quay về bản gốc". Vai kiểm ở đây (`companyAccess`); mỗi thao tác MỘT tx scope
// system, khoá dòng `FOR UPDATE`. Chặn tắt flow không điều kiện cuối cùng của sự kiện `required` (FR-20 lưới cuối).
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { AppError, appError } from "../../../lib/errors";
import { groupIdsByKey, groupMissingMessage } from "../defs/def-group-bind";
import { libraryFlowDef } from "../runs/runs.repo";
import { bindGroupKeys, groupKeysOf } from "../triggers/group-keys.rules";
import * as r from "./company-flows.repo";
import { companyAccess } from "./library-company.service";

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
    kind: company ? "company" : "assigned",
    trigger_event: x.trigger_event ?? "",
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
    const ev = x.trigger_event ? EVENTS.get(x.trigger_event) : undefined;
    const shadowed = !!ev?.decides && x.enabled && blocked.has(ev.key);
    if (ev && x.enabled && !x.has_condition) blocked.add(ev.key);
    return toRow(x, shadowed);
  });
}

export class CompanyFlowsService {
  constructor(private readonly db: Db) {}

  #tx<T>(u: AuthUser, tid: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    companyAccess(u, tid);
    return withHubScope(this.db, SYS, fn);
  }
  async #locked(tx: Tx, tid: string, id: string): Promise<r.CfRow> {
    const row = await r.lockCompanyFlow(tx, tid, id);
    if (!row) throw appError("NOT_FOUND");
    return row;
  }
  #list = async (tx: Tx, tid: string) => ({ items: toRows(await r.listCompanyFlows(tx, tid)) });

  list(u: AuthUser, tid: string) {
    return this.#tx(u, tid, (tx) => this.#list(tx, tid));
  }

  /** Gán flow cho công ty: chỉ platform_admin; def phải là Thư viện đã xuất bản hoặc def của chính công ty (soát E1 #2). */
  assign(u: AuthUser, tid: string, flowId: string) {
    if (u.role !== "platform_admin") throw appError("FORBIDDEN");
    return this.#tx(u, tid, async (tx) => {
      if (!(await r.assignableDef(tx, tid, flowId)))
        throw err(
          "FLOW_NOT_ASSIGNABLE",
          422,
          "Quy trình không gán được: cần quy trình Thư viện đã xuất bản và có Bắt đầu khi.",
        );
      await r.insertCompanyFlow(tx, {
        tid,
        flowId,
        enabled: true,
        offReason: null,
        actor: u.userId,
      });
      return this.#list(tx, tid);
    });
  }

  setEnabled(u: AuthUser, tid: string, id: string, enabled: boolean) {
    return this.#tx(u, tid, async (tx) => {
      const row = enabled
        ? await this.#lockPairForEnable(tx, tid, id)
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
    return this.#tx(u, tid, async (tx) => {
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

  /** "Sao chép để sửa": bản công ty cùng định dạng (Tắt, chưa xuất bản); bấm lần hai ⇒ trả bản đã có. */
  clone(u: AuthUser, tid: string, id: string) {
    return this.#tx(u, tid, async (tx) => {
      const row = await this.#locked(tx, tid, id);
      if (row.def_tenant_id !== null)
        throw err("NOT_LIBRARY_FLOW", 422, "Chỉ sao chép được quy trình được gán từ Thư viện.");
      const had = await r.copyRowOf(tx, tid, row.flow_id);
      if (had) return { id: had, ...(await this.#list(tx, tid)) };
      const def = await libraryFlowDef(tx, row.flow_id);
      if (!def) throw err("FLOW_NOT_ASSIGNABLE", 422, "Quy trình Thư viện chưa có bản xuất bản.");
      const keys = groupKeysOf(def.stages);
      // CR-122 · P15 · bản công ty chỉ giữ id: mã → id của công ty; mã chưa có nhóm ⇒ để trống + cảnh báo (KHÔNG chặn sao chép).
      const b = bindGroupKeys(def.stages, await groupIdsByKey(tx, tid, keys), { strip: true });
      const key = await r.freeKey(tx, tid, `${row.flow_key.slice(0, 26)}-cty`);
      const flowId = await r.insertCopyDef(tx, {
        tid,
        src: row.flow_id,
        key,
        stages: b.stages,
        actor: u.userId,
      });
      const cid = await r.insertCompanyFlow(tx, {
        tid,
        flowId,
        enabled: false,
        offReason: "not_published",
        position: row.position,
        actor: u.userId,
      });
      const missing = b.missing.length
        ? { missing_group_keys: b.missing, message: groupMissingMessage(b.missing) }
        : {};
      return { id: cid, ...(await this.#list(tx, tid)), ...missing };
    });
  }

  /** Xuất bản bản công ty theo id dòng (đường cũ, UI không còn gọi — "Lưu và áp dụng" dùng `apply`). Cùng `#activate`. */
  publish(u: AuthUser, tid: string, id: string) {
    return this.#tx(u, tid, async (tx) => {
      await this.#activate(tx, u, tid, await this.#locked(tx, tid, id));
      return this.#list(tx, tid);
    });
  }

  /**
   * CR-123 FLOW3-FR-10 · "Lưu và áp dụng" (bước áp dụng, sau khi editor lưu def): theo id def của công ty ⇒ bản đó thành flow đang dùng
   * của sự kiện, thay bản gốc Thư viện (nếu có) — MỘT tx, số câu SQL cố định. Hợp đồng đang chờ giữ bản cũ (đã gắn def lúc gửi).
   * Def tự tạo chưa có dòng ⇒ tạo dòng Bật. Chặn khi còn bước duyệt chưa chọn nhóm.
   */
  apply(u: AuthUser, tid: string, flowId: string) {
    return this.#tx(u, tid, async (tx) => {
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
      return { id, ...(await this.#list(tx, tid)) };
    });
  }

  /** Bản công ty ⇒ Bật; bản gốc Thư viện của nó ⇒ Tắt (`replaced_by`) — một tx, không bao giờ cùng Bật. Row `row` đã khoá. */
  async #activate(tx: Tx, u: AuthUser, tid: string, row: r.CfRow): Promise<void> {
    if (row.def_tenant_id === null)
      throw err("NOT_COMPANY_COPY", 422, "Chỉ xuất bản được bản công ty.");
    const orig = await r.originalRowOf(tx, tid, row.flow_id);
    if (orig) {
      const o = await this.#locked(tx, tid, orig);
      // bản công ty có điều kiện thay bản gốc không điều kiện ⇒ sự kiện `required` không được hết flow phủ mọi trường hợp
      if (o.enabled && row.has_condition) await this.#guardRequired(tx, tid, o);
      await r.setFlowState(tx, {
        tid,
        id: orig,
        enabled: false,
        offReason: "replaced",
        replacedBy: row.id,
        actor: u.userId,
      });
    }
    await r.setFlowState(tx, {
      tid,
      id: row.id,
      enabled: true,
      offReason: null,
      replacedBy: null,
      actor: u.userId,
    });
  }

  /** "Quay về bản gốc": bật lại gốc, tắt bản sao (giữ để dùng lại, lý do "đã quay về bản gốc") — một tx. */
  revert(u: AuthUser, tid: string, id: string) {
    return this.#tx(u, tid, async (tx) => {
      const row = await this.#locked(tx, tid, id);
      const orig = row.def_tenant_id === null ? null : await r.originalRowOf(tx, tid, row.flow_id);
      if (!orig)
        throw err("NOT_COMPANY_COPY", 422, "Chỉ bản sao từ Thư viện mới quay về bản gốc được.");
      await this.#locked(tx, tid, orig);
      await r.setFlowState(tx, {
        tid,
        id: orig,
        enabled: true,
        offReason: null,
        replacedBy: null,
        actor: u.userId,
      });
      await r.setFlowState(tx, {
        tid,
        id,
        enabled: false,
        offReason: "reverted",
        replacedBy: null,
        actor: u.userId,
      });
      return this.#list(tx, tid);
    });
  }

  /**
   * Soát E1b B1 · bật một dòng: bản sao "chưa xuất bản" phải qua Xuất bản; bản gốc và bản sao không bao giờ cùng Bật. Khoá theo thứ
   * tự CỐ ĐỊNH bản sao trước, gốc sau (như publish/revert) rồi mới kiểm bản đối ứng đang Tắt — không đua, không deadlock.
   */
  async #lockPairForEnable(tx: Tx, tid: string, id: string): Promise<r.CfRow> {
    const peek = await r.lockCompanyFlow(tx, tid, id, false);
    if (!peek) throw appError("NOT_FOUND");
    const isCopy = peek.def_tenant_id !== null;
    const other = isCopy
      ? await r.originalRowOf(tx, tid, peek.flow_id)
      : await r.copyRowOf(tx, tid, peek.flow_id);
    const [copyId, origId] = isCopy ? [id, other] : [other, id];
    const locked = new Map<string, r.CfRow>();
    for (const x of [copyId, origId]) if (x) locked.set(x, await this.#locked(tx, tid, x));
    const row = locked.get(id) as r.CfRow;
    if (row.off_reason === "not_published")
      throw err(
        "FLOW_NOT_PUBLISHED",
        409,
        "Bản công ty chưa xuất bản. Bấm Xuất bản để dùng bản này thay bản gốc.",
      );
    if (other && locked.get(other)?.enabled)
      throw err(
        "FLOW_PAIR_ACTIVE",
        409,
        isCopy
          ? "Bản gốc đang bật. Dùng Xuất bản để thay bản gốc bằng bản công ty."
          : "Bản công ty đang bật thay bản gốc. Dùng Quay về bản gốc để bật lại bản gốc.",
      );
    return row;
  }

  async #guardRequired(tx: Tx, tid: string, row: r.CfRow): Promise<void> {
    const ev = row.trigger_event ? EVENTS.get(row.trigger_event) : undefined;
    if (!ev?.required || !row.enabled || row.has_condition) return;
    if ((await r.unconditionalOn(tx, tid, ev.key, row.id)) > 0) return;
    throw err(
      "FLOW_REQUIRED_LAST",
      409,
      `"${ev.label}" cần ít nhất một quy trình đang bật không điều kiện. Bật hoặc thêm quy trình khác trước khi tắt quy trình này.`,
    );
  }
}
