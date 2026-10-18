// ADM-FR-65 · ADM-FR-66 · ADM-FR-67 · HUB-FR-104 · HUB-FR-114 · nghiệp vụ `/process-defs*` + `GET /agent-teams` (plan-contract §6).
// Ghi qua `withConfigWrite` (D17: scope system, khoá `config_meta` trước ⇒ key không race, version 409, audit, NOTIFY);
// đọc: tx system read only. Phạm vi tenant (`DefScope`) chốt một lần ở route; mọi câu repo lọc theo nó.

import { TENANT_TZ_DEFAULT } from "@ai/contracts";
import type {
  AgentTeamListResponse,
  CopyProcessDefRequest,
  ProcessDef,
  ProcessDefInput,
  ProcessDefListQuery,
  ProcessDefListResponse,
  ProcessEditorContext,
  ProcessRunSummary,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { validationError } from "../../../lib/http";
import { dbHubAudit } from "../../../lib/hub-audit";
import { sourceError } from "../../sources/sources.errors";
import { type StudioAudit, withConfigWrite } from "../../studio/studio-write";
import { tenantTzRepo } from "../adapters/timers/tenant-tz.repo";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
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

export class DefsService {
  readonly #w;
  constructor(private readonly d: Pick<ProcessDeps, "db" | "start">) {
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
      const rows = await repo.listDefs(tx, {
        ...s,
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

  /** P-d1 · TZ-R04 · AC-H46 · ngữ cảnh editor: múi giờ tenant (`null` = phạm vi mẫu ⇒ `TENANT_TZ_DEFAULT`). */
  editorContext(tenantId: string | null): Promise<ProcessEditorContext> {
    if (tenantId === null) return Promise.resolve({ timezone: TENANT_TZ_DEFAULT });
    return this.#read(async (tx) => ({ timezone: await tenantTzRepo(tx, tenantId).read() }));
  }

  teams(s: Scope): Promise<AgentTeamListResponse> {
    return this.#read(async (tx) => {
      const { teams, members } = await listTeams(tx, s.tenantId);
      return { items: toTeams(teams, members) };
    });
  }

  /** Kiểm định nghĩa theo tham chiếu của tenant đích (mẫu: agent/nhóm đang bật, không Group/user) + nguồn còn sống. */
  async #check(tx: Tx, tenantId: string | null, input: ProcessDefInput): Promise<void> {
    throwIfInvalid(validateProcessDef(input, await loadDefRefs(tx, tenantId)));
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
    const r = await repo.readDef(tx, s, id, true);
    if (!r) throw appError("NOT_FOUND");
    if (r.tenant_id === null && u.role !== "platform_admin") throw defError("TEMPLATE_READ_ONLY");
    if (r.version !== version)
      throw appError("VERSION_CONFLICT", { current: toProcessDef(r), updated_at: r.updated_at });
    return r;
  }

  async create(u: AuthUser, s: Scope, input: ProcessDefInput): Promise<ProcessDef> {
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      await this.#check(tx, s.tenantId, input);
      await this.#keyFree(tx, s.tenantId, input.key);
      const row = await repo.insertDef(tx, {
        tenantId: s.tenantId,
        input: withHandoff(input),
        sourceTemplateId: null,
        actorId: u.userId,
      });
      return {
        result: row,
        audit: audit({ action: "create", row, before: null, after: auditSnapshot(row) }),
      };
    });
    return toProcessDef(result);
  }

  async update(
    u: AuthUser,
    s: Scope,
    id: string,
    b: ProcessDefInput & { version: number },
  ): Promise<ProcessDef> {
    const { version, ...input } = b;
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const cur = await this.#lock(tx, u, { s, id, version });
      await this.#check(tx, cur.tenant_id, input);
      await this.#keyFree(tx, cur.tenant_id, input.key, id);
      const row = await repo.updateDef(tx, id, withHandoff(input), u.userId);
      const a = {
        action: "update" as const,
        row,
        before: auditSnapshot(cur),
        after: auditSnapshot(row),
      };
      return { result: row, audit: audit(a) };
    });
    return toProcessDef(result);
  }

  async remove(u: AuthUser, s: Scope, id: string, version: number): Promise<void> {
    await withConfigWrite(this.#w, u, async (tx) => {
      const cur = await this.#lock(tx, u, { s, id, version });
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
      if (!tpl || tpl.tenant_id !== null) throw appError("NOT_FOUND");
      const input = withHandoff(copyFromTemplate(inputOf(tpl), b));
      await this.#checkSources(tx, tenantId, input.sources);
      await this.#keyFree(tx, tenantId, input.key);
      const row = await repo.insertDef(tx, {
        tenantId,
        input,
        sourceTemplateId: tpl.id,
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
  async run(u: AuthUser, s: Scope, id: string, input: string): Promise<ProcessRunSummary> {
    if (u.role !== "tenant_admin" || s.tenantId !== u.tenantId) throw appError("FORBIDDEN");
    const def = await this.#read((tx) => repo.readDef(tx, s, id));
    if (!def || def.tenant_id === null || !def.enabled)
      throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    return this.d.start.fromAdmin(u, def.id, input);
  }
}
