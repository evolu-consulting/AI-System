// ADM-FR-65 · ADM-FR-66 · ADM-FR-67 · HUB-FR-104 · HUB-FR-114 · nghiệp vụ `/process-defs*` + `GET /agent-teams` (plan-contract §6).
// Ghi qua `withConfigWrite` (D17: scope system, khoá `config_meta` trước ⇒ key không race, version 409, audit, NOTIFY);
// đọc: tx system read only. Phạm vi tenant (`DefScope`) chốt một lần ở route; mọi câu repo lọc theo nó.

import type {
  AgentTeamListResponse,
  CopyProcessDefRequest,
  FlowEdgeIssue,
  ProcessDef,
  ProcessDefInput,
  ProcessDefListQuery,
  ProcessDefListResponse,
  ProcessDefSaved,
  ProcessEditorContext,
  ProcessInputValue,
  ProcessRunSummary,
} from "@ai/contracts/hub-admin";
import { TENANT_TZ_DEFAULT } from "@ai/contracts/tenants";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import { dbHubAudit } from "../../../lib/hub-audit";
import { nodeConfigRegistry } from "../../packs/kit/public";
import { sourceError } from "../../sources/sources.errors";
import { type StudioAudit, withConfigWrite } from "../../studio/studio-write";
import { tenantTzRepo } from "../adapters/timers/tenant-tz.repo";
import { toolSwitchReader, toToolItem } from "../adapters/tools/tool-switch.repo";
import { listTools } from "../application/tools/list-tools.usecase";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { ttlOnCreate, ttlOnUpdate } from "../domain/defs/ttl.rules";
import {
  guardInUse,
  libError,
  libraryRefs,
  slotDraft,
  specOrThrow,
} from "../library/library-draft";
import { toolKeysOf } from "../nodes/registry";
import {
  autofixSourceKindMiss,
  copyFromTemplate,
  decodeDefCursor,
  encodeDefCursor,
  validateProcessDef,
  withHandoff,
} from "./def.rules";
import {
  auditSnapshot,
  defError,
  inputOf,
  throwIfInvalid,
  toListItem,
  toProcessDef,
  toTeams,
} from "./defs.map";
import * as repo from "./defs.repo";
import { edgeCheck, withWarnings } from "./edge-check";
import { flowDefPaths } from "./flow-def.rules";
import { nodeFeatureError, nodeFeatureMiss } from "./node-features";
import { listTeams, loadDefRefs } from "./teams.repo";

type Scope = repo.DefScope;
type Audit = Pick<StudioAudit, "action" | "before" | "after"> & { row: repo.DefRow };

const audit = (a: Audit): StudioAudit => ({
  tenantId: a.row.tenant_id,
  action: a.action,
  entity: "process_def",
  entityId: a.row.id,
  entityName: a.row.key,
  before: a.before,
  after: a.after,
  summary: { key: a.row.key, version: a.row.version },
});

/** CR-122 · N1 · FR-25 · bước là node của tính năng đã tắt cho công ty ⇒ 422 `FLOW_NODE_FEATURE_OFF` (def Thư viện: không xét). */
async function nodeCheck(
  d: { config?: ProcessDeps["config"] },
  tenantId: string | null,
  input: ProcessDefInput,
): Promise<void> {
  if (tenantId === null || !d.config) return; // config vắng chỉ ở test dựng deps tối thiểu
  const miss = await nodeFeatureMiss(
    d.config,
    tenantId,
    input.stages.map((x) => x.node),
  );
  if (miss) throw nodeFeatureError(miss);
  // CR-122 · E5b · cấu hình riêng của node (validator do gói đăng ký ở kit) ⇒ 422 `FLOW_NODE_CONFIG_INVALID` + path.
  const issues = await nodeConfigRegistry.check(tenantId, input.stages);
  if (issues.length > 0) throw defError("FLOW_NODE_CONFIG_INVALID", { issues });
}

/** CR-122 · E1 · def có `trigger` ⇒ luật FlowDef (422 `PROCESS_DEF_INVALID`, `paths`). */
function flowCheck(input: ProcessDefInput, tenantId: string | null, cur: repo.DefRow | null): void {
  const paths = flowDefPaths(input, tenantId, cur);
  if (paths.length > 0) throw defError("PROCESS_DEF_INVALID", { paths });
}
export class DefsService {
  readonly #w;
  constructor(
    private readonly d: Pick<ProcessDeps, "db" | "start" | "packTools"> & {
      config?: ProcessDeps["config"];
    },
  ) {
    this.#w = { db: d.db, audit: dbHubAudit };
  }

  #read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  list(s: Scope, q: ProcessDefListQuery): Promise<ProcessDefListResponse> {
    const after = q.cursor === undefined ? undefined : decodeDefCursor(q.cursor);
    if (after === null)
      throw validationError([{ path: ["cursor"], code: "custom", message: "Invalid cursor" }]);
    return this.#read(async (tx) => {
      if (q.kind === "library" && !s.library) throw appError("FORBIDDEN"); // CR-105 · platform_admin
      const rows = await repo.listDefs(tx, {
        ...s,
        ...(q.kind ? { kind: q.kind } : {}),
        includeTemplates: q.include_templates,
        limit: q.limit,
        after,
      });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map(toListItem),
        next_cursor:
          rows.length > q.limit && last ? encodeDefCursor([last.updated_at, last.id]) : null,
      };
    });
  }

  get(s: Scope, id: string): Promise<ProcessDef> {
    return this.#read(async (tx) => {
      const r = await repo.readDef(tx, s, id);
      if (!r) throw appError("NOT_FOUND");
      return toProcessDef(r);
    });
  }

  /**
   * P-d1 · TZ-R04 · AC-H46 · ngữ cảnh editor: múi giờ tenant (`null` = phạm vi mẫu ⇒ `TENANT_TZ_DEFAULT`). P-d2 · TT-R04 ·
   * `tools` = tool bật cho tenant (S6: tenant theo `defScopeOf`); rỗng / mẫu ⇒ vắng trường (contract optional, FE `?? []`;
   * giữ hình P-d1 cho tenant chưa bật tool) — 2 câu cố định (PD2-P02).
   */
  editorContext(tenantId: string | null): Promise<ProcessEditorContext> {
    if (tenantId === null) return Promise.resolve({ timezone: TENANT_TZ_DEFAULT });
    // Hai câu đọc độc lập (không cần ảnh nhất quán) ⇒ tx mặc định, không `set transaction` (PD2-P02: 2 câu).
    return withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const timezone = await tenantTzRepo(tx, tenantId).read();
      const tools = (await listTools(toolSwitchReader(tx, tenantId, this.d.packTools))).map(
        toToolItem,
      );
      return tools.length > 0 ? { timezone, tools } : { timezone };
    });
  }

  teams(s: Scope): Promise<AgentTeamListResponse> {
    return this.#read(async (tx) => {
      const { teams, members } = await listTeams(tx, s.tenantId);
      return { items: toTeams(teams, members) };
    });
  }

  /** Kiểm định nghĩa theo tham chiếu của tenant đích (mẫu: agent/nhóm đang bật, không Group/user) + nguồn còn sống. */
  async #check(
    tx: Tx,
    tenantId: string | null,
    input: ProcessDefInput,
    lib = false,
  ): Promise<void> {
    const toolKeys = toolKeysOf(input.stages);
    const refs = lib
      ? await libraryRefs(tx, input.stages, this.d.packTools)
      : await loadDefRefs(tx, tenantId, toolKeys, this.d.packTools);
    throwIfInvalid(validateProcessDef(input, refs, { library: lib }));
    await this.#checkSources(tx, tenantId, input.sources);
    await this.#checkAutofixKinds(tx, tenantId, input);
  }

  /** PC-R01 · nguồn của stage tự-sửa phải là git_remote/local_path; library ⇒ 422 PROCESS_REF_INVALID (path autofix.source_key). */
  async #checkAutofixKinds(tx: Tx, tenantId: string | null, input: ProcessDefInput): Promise<void> {
    const keys = [
      ...new Set(input.stages.flatMap((s) => (s.autofix ? [s.autofix.source_key] : []))),
    ];
    if (tenantId === null || keys.length === 0) return; // mẫu: key tĩnh, kiểm khi chép
    const path = autofixSourceKindMiss(
      input.stages,
      await repo.liveSourceKinds(tx, tenantId, keys),
    );
    if (path) throw defError("PROCESS_REF_INVALID", { path, ref: "source" });
  }

  /** PB-R06 · mọi key trong `def.sources` phải là nguồn còn sống của tenant; lạ/khác tenant ⇒ 404 SOURCE_NOT_FOUND. */
  async #checkSources(tx: Tx, tenantId: string | null, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const live = await repo.liveSourceKeys(tx, tenantId, keys);
    if (keys.some((k) => !live.has(k))) throw sourceError("SOURCE_NOT_FOUND");
  }

  async #keyFree(tx: Tx, tenantId: string | null, key: string, exceptId?: string): Promise<void> {
    if (await repo.keyTaken(tx, tenantId, key, exceptId))
      throw defError("PROCESS_KEY_TAKEN", { field: "key" });
  }

  /** 404 (ngoài phạm vi/đã xoá) → 403 mẫu với tenant_admin → 409 version lệch. */
  async #lock(
    tx: Tx,
    u: AuthUser,
    k: { s: Scope; id: string; version: number },
  ): Promise<repo.DefRow> {
    const { s, id, version } = k;
    // CR-105 · ghi def thư viện chỉ platform_admin: nhìn cả def có `slot` để trả 403 (như mẫu), không 404.
    const r = await repo.readDef(tx, { ...s, library: true }, id, true);
    if (!r) throw appError("NOT_FOUND");
    if (r.tenant_id === null && u.role !== "platform_admin") throw defError("TEMPLATE_READ_ONLY");
    if (r.version !== version)
      throw appError("VERSION_CONFLICT", { current: toProcessDef(r), updated_at: r.updated_at });
    return r;
  }

  /** CR-105 · nháp có `slot` ⇒ chỉ platform_admin, phạm vi mẫu; `stages` = biên dịch từ `slot_body`. */
  #draft(u: AuthUser, tenantId: string | null, input: ProcessDefInput, cur: repo.DefRow | null) {
    const slot = input.slot === undefined ? (cur?.slot ?? null) : input.slot;
    // Review CR-105: def thư viện không bỏ khe được — thành mẫu chạy thử ⇒ mọi tenant đọc được (lộ user id của tenant nguồn).
    if (slot === null && cur !== null && cur.slot !== null)
      throw libError("SLOT_BODY_INVALID", { issues: [{ path: "slot", rule: "SLOT_LOCKED" }] });
    if (slot === null) return { input, slot: null, body: null };
    if (u.role !== "platform_admin") throw appError("FORBIDDEN");
    if (tenantId !== null)
      throw validationError([{ path: ["slot"], code: "custom", message: "Template scope only" }]);
    const d = slotDraft(specOrThrow(slot), input, cur?.slot === slot ? cur : null);
    return { input: d.input, slot, body: d.body };
  }

  /**
   * CR-121 c17 · bản riêng của công ty (sao từ def thư viện, có `slot_body`) lưu theo ĐƯỜNG KHE: `slot_body` thắng `stages` (như `slotDraft`),
   * `stages` biên dịch lại từ body, `slot_body` được GIỮ (launch đọc `slot_body` của bản riêng — c9b). Khe lấy từ def nguồn; `slot` của hàng vẫn null.
   * Không phải bản riêng có body ⇒ null (đường cũ).
   */
  async #companyCopyDraft(tx: Tx, cur: repo.DefRow, input: ProcessDefInput) {
    if (cur.tenant_id === null || cur.slot !== null || cur.source_template_id === null) return null;
    if (cur.slot_body === null || cur.slot_body === undefined) return null;
    const srcSlot = await repo.sourceSlotOf(tx, cur.source_template_id);
    if (srcSlot === null) throw libError("COPY_SOURCE_REMOVED", { source: cur.source_template_id });
    const d = slotDraft(specOrThrow(srcSlot), input, {
      stages: cur.stages,
      slot_body: cur.slot_body,
    });
    return { input: d.input, slot: null, body: d.body };
  }

  async create(u: AuthUser, s: Scope, raw: ProcessDefInput): Promise<ProcessDefSaved> {
    let warnings: FlowEdgeIssue[] = [];
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const { input, slot, body } = this.#draft(u, s.tenantId, raw, null);
      flowCheck(input, s.tenantId, null);
      await nodeCheck(this.d, s.tenantId, input);
      warnings = await edgeCheck(this.d, s.tenantId, input);
      await this.#check(tx, s.tenantId, input, slot !== null);
      await this.#keyFree(tx, s.tenantId, input.key);
      const row = await repo.insertDef(tx, {
        tenantId: s.tenantId,
        input: withHandoff(input),
        sourceTemplateId: null,
        ttlDays: ttlOnCreate(input.ttl_days),
        actorId: u.userId,
        slot,
        slotBody: body,
      });
      return {
        result: row,
        audit: audit({ action: "create", row, before: null, after: auditSnapshot(row) }),
      };
    });
    return withWarnings(toProcessDef(result), warnings);
  }

  async update(
    u: AuthUser,
    s: Scope,
    id: string,
    b: ProcessDefInput & { version: number },
  ): Promise<ProcessDefSaved> {
    const { version, ...raw } = b;
    let warnings: FlowEdgeIssue[] = [];
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const cur = await this.#lock(tx, u, { s, id, version });
      const copy = await this.#companyCopyDraft(tx, cur, raw);
      const { input, slot, body } = copy ?? this.#draft(u, cur.tenant_id, raw, cur);
      await guardInUse(tx, cur, { key: input.key, slot, enabled: input.enabled });
      // def khe / bản riêng lưu theo khe (kể cả đã backfill trigger) theo đường khe, không áp luật FlowDef.
      if (slot === null && copy === null) flowCheck(input, cur.tenant_id, cur);
      await nodeCheck(this.d, cur.tenant_id, input);
      warnings = await edgeCheck(this.d, cur.tenant_id, input);
      // bản riêng sao từ thư viện: stage dùng khoá nhóm/tool của khe (không phải id nhóm) ⇒ kiểm tham chiếu như def thư viện
      await this.#check(tx, cur.tenant_id, input, slot !== null || copy !== null);
      await this.#keyFree(tx, cur.tenant_id, input.key, id);
      const row = await repo.updateDef(tx, {
        id,
        input: withHandoff(input),
        ttlDays: ttlOnUpdate(input.ttl_days, cur.ttl_days),
        actorId: u.userId,
        slot,
        slotBody: body,
      });
      const a = {
        action: "update" as const,
        row,
        before: auditSnapshot(cur),
        after: auditSnapshot(row),
      };
      return { result: row, audit: audit(a) };
    });
    return withWarnings(toProcessDef(result), warnings);
  }

  async remove(u: AuthUser, s: Scope, id: string, version: number): Promise<void> {
    await withConfigWrite(this.#w, u, async (tx) => {
      const cur = await this.#lock(tx, u, { s, id, version });
      await guardInUse(tx, cur, "delete");
      await repo.softDeleteDef(tx, id, u.userId);
      return {
        result: null,
        audit: audit({ action: "delete", row: cur, before: auditSnapshot(cur), after: null }),
      };
    });
  }

  /** Mẫu → tenant đích (platform_admin phải chọn tenant). Không kiểm tham chiếu: bản chép tắt, admin gán đủ rồi bật. */
  async copy(u: AuthUser, s: Scope, id: string, b: CopyProcessDefRequest): Promise<ProcessDef> {
    const tenantId = s.tenantId;
    if (tenantId === null) throw appError("TENANT_REQUIRED");
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const tpl = await repo.readDef(tx, s, id);
      if (!tpl || tpl.tenant_id !== null || tpl.slot !== null) throw appError("NOT_FOUND"); // CR-105
      const input = withHandoff(copyFromTemplate(inputOf(tpl), b));
      await this.#checkSources(tx, tenantId, input.sources);
      await this.#keyFree(tx, tenantId, input.key);
      const row = await repo.insertDef(tx, {
        tenantId,
        input,
        sourceTemplateId: tpl.id,
        ttlDays: ttlOnCreate(tpl.ttl_days),
        actorId: u.userId,
      });
      return {
        result: row,
        audit: audit({ action: "copy", row, before: null, after: auditSnapshot(row) }),
      };
    });
    return toProcessDef(result);
  }

  /** ADM-FR-67 · chỉ user của tenant (platform_admin ⇒ 403); quy trình tắt/mẫu/không thấy ⇒ 404 `PROCESS_NOT_FOUND`. */
  async run(
    u: AuthUser,
    s: Scope,
    id: string,
    input: string,
    inputs?: ProcessInputValue[],
    test?: boolean,
  ): Promise<ProcessRunSummary> {
    if (u.role !== "tenant_admin" || s.tenantId !== u.tenantId) throw appError("FORBIDDEN");
    const def = await this.#read((tx) => repo.readDef(tx, s, id));
    if (!def || def.tenant_id === null || !def.enabled)
      throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    // CR-122 · N2 · như đường mở lượt từ sự kiện (`flow-launch`): node của tính năng đã tắt ⇒ 422 `FLOW_NODE_FEATURE_OFF`, không mở lượt.
    if (this.d.config) {
      const miss = await nodeFeatureMiss(
        this.d.config,
        def.tenant_id,
        def.stages.map((x) => x.node),
      );
      if (miss) throw nodeFeatureError(miss);
    }
    return this.d.start.fromAdmin(u, def.id, input, inputs, test);
  }
}
