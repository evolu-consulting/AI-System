// CR-105 · L2a · design §4: nghiệp vụ thư viện quy trình (chỉ platform_admin — cổng ở route). Ghi qua `withConfigWrite` (scope system,
// khoá `config_meta` trước ⇒ hai lần ghi tuần tự; publish/rollback khoá hàng def FOR UPDATE + tăng version nháp ⇒ lần thứ hai cùng
// `version` nhận 409) + `dbHubAudit` (publish/rollback/assign/unassign/set_default). B2 trước mọi xuất bản/quay lại/gán/đổi mặc định.
import type {
  ProcessAssignment,
  ProcessDef,
  ProcessImpact,
  ProcessRelease,
  ProcessReleaseDetail,
  ProcessSlot,
  ReleaseRef,
  TenantProcessSlot,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import { type StudioAudit, withConfigWrite } from "../../studio/studio-write";
import type { ProcessDeps } from "../core/ports";
import { defError, toProcessDef } from "../defs/defs.map";
import { readDef } from "../defs/defs.repo";
import * as lib from "./library.repo";
import { libError, specOrThrow } from "./library-draft";
import { bodyUserIds, publishIssues } from "./library-publish.rules";
import * as asg from "./slot-assign.repo";
import { listSlots, type SlotSpec } from "./slots";

type Act = "publish" | "rollback" | "assign" | "unassign" | "set_default" | "copy";
const audit = (
  action: Act,
  def: { id: string; key: string },
  o: {
    tenantId?: string | null;
    before?: Record<string, unknown> | null;
    after: Record<string, unknown>;
  },
): StudioAudit => ({
  tenantId: o.tenantId ?? null,
  action,
  entity: "process_def",
  entityId: def.id,
  entityName: def.key,
  before: o.before ?? null,
  after: o.after,
  summary: { key: def.key, ...o.after },
});
const feature = (spec: SlotSpec) => `${spec.packKey}-read`;
const notFound = () => appError("NOT_FOUND");

export class LibraryService {
  readonly #w;
  constructor(private readonly d: Pick<ProcessDeps, "db" | "packTools">) {
    this.#w = { db: d.db, audit: dbHubAudit };
  }

  #read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  async #def(tx: Tx, id: string, lock = false): Promise<lib.LibRow> {
    const r = await lib.readLibDef(tx, id, lock);
    if (!r) throw notFound();
    return r;
  }

  /** B2: luật khe + nút hệ thống + bước không tới được, rồi Group/user theo MỌI tenant của `a` (một câu). */
  async #b2(
    tx: Tx,
    def: { slot: string; stages: unknown[]; slot_body: unknown },
    a: Omit<asg.Affected, "slot" | "feature">,
  ) {
    const spec = specOrThrow(def.slot);
    const issues = publishIssues({
      stages: def.stages as never,
      systemTools: spec.systemTools,
      bodyIssues: spec.validate(def.slot_body),
    });
    if (issues.length) throw libError("PROCESS_PUBLISH_INVALID", { issues });
    const need = { keys: spec.groupKeys(def.slot_body), users: bodyUserIds(def.slot_body) };
    const miss = await asg.firstMiss(tx, { ...a, slot: def.slot, feature: feature(spec) }, need);
    if (miss?.keys.length)
      throw libError("SLOT_GROUPS_MISSING", {
        tenant: miss.tenant,
        tenant_id: miss.tenant_id,
        keys: miss.keys,
      });
    if (miss) throw defError("PROCESS_REF_INVALID", { path: "slot_body", ref: "user" });
  }

  impact(id: string): Promise<ProcessImpact> {
    return this.#read(async (tx) => {
      const def = await this.#def(tx, id);
      const { is_default } = await lib.usage(tx, id);
      const spec = specOrThrow(def.slot);
      const a = {
        slot: def.slot,
        feature: feature(spec),
        defId: id,
        asDefault: is_default,
        tenantIds: [],
      };
      return { ...(await asg.impactOf(tx, a)), is_default };
    });
  }

  async publish(
    u: AuthUser,
    id: string,
    b: { version: number; note?: string | undefined },
  ): Promise<ReleaseRef> {
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const def = await this.#def(tx, id, true);
      if (def.version !== b.version)
        throw appError("VERSION_CONFLICT", { current_version: def.version });
      const { is_default } = await lib.usage(tx, id);
      await this.#b2(tx, def, { defId: id, asDefault: is_default, tenantIds: [] });
      const snap = { name: def.name, stages: def.stages, slotBody: def.slot_body };
      const r = await lib.release(tx, { id, snap, actorId: u.userId, note: b.note ?? "" });
      const after = { rel_version: r.rel_version, version: r.version };
      return { result: { rel_version: r.rel_version }, audit: audit("publish", def, { after }) };
    });
    return result;
  }

  async rollback(
    u: AuthUser,
    id: string,
    b: { rel_version: number; version?: number | undefined },
  ): Promise<ReleaseRef> {
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const def = await this.#def(tx, id, true);
      if (b.version !== undefined && def.version !== b.version)
        throw appError("VERSION_CONFLICT", { current_version: def.version });
      const old = await lib.readRelease(tx, id, b.rel_version);
      if (!old) throw notFound();
      const { is_default } = await lib.usage(tx, id);
      await this.#b2(
        tx,
        { slot: def.slot, stages: old.stages, slot_body: old.slot_body },
        {
          defId: id,
          asDefault: is_default,
          tenantIds: [],
        },
      );
      const snap = { name: old.name, stages: old.stages, slotBody: old.slot_body };
      const note = `rollback v${b.rel_version}`;
      const r = await lib.release(tx, { id, snap, actorId: u.userId, note });
      const after = { rel_version: r.rel_version, from: b.rel_version, version: r.version };
      return { result: { rel_version: r.rel_version }, audit: audit("rollback", def, { after }) };
    });
    return result;
  }

  releases(id: string): Promise<{ items: ProcessRelease[] }> {
    return this.#read(async (tx) => {
      await this.#def(tx, id);
      return { items: (await lib.listReleases(tx, id)).map(toRelease) };
    });
  }

  release(id: string, v: number): Promise<ProcessReleaseDetail> {
    return this.#read(async (tx) => {
      await this.#def(tx, id);
      const r = await lib.readRelease(tx, id, v);
      if (!r) throw notFound();
      return { ...toRelease(r), stages: r.stages, slot_body: r.slot_body };
    });
  }

  /** Nhân bản (kể cả đang dùng) ⇒ nháp mới cùng khe, chưa xuất bản, chưa gán. Key vắng ⇒ `<key>-<n>` trống đầu tiên. */
  async clone(
    u: AuthUser,
    id: string,
    b: { key?: string | undefined; name?: string | undefined },
  ): Promise<ProcessDef> {
    const { result } = await withConfigWrite(this.#w, u, async (tx) => {
      const src = await this.#def(tx, id);
      const key = b.key ?? (await freeKey(tx, src.key));
      if ((await lib.libKeysLike(tx, key)).has(key))
        throw defError("PROCESS_KEY_TAKEN", { field: "key" });
      const name = b.name ?? `${src.name} (bản sao)`.slice(0, 120);
      const newId = await lib.insertClone(tx, { src: id, key, name, actorId: u.userId });
      const row = await readDef(tx, { tenantId: null, library: true }, newId);
      if (!row) throw new Error("clone: không đọc lại được");
      const after = { from: src.id, key };
      return { result: row, audit: audit("copy", { id: newId, key }, { after }) };
    });
    return toProcessDef(result);
  }

  assignments(id: string): Promise<{ items: ProcessAssignment[] }> {
    return this.#read(async (tx) => {
      await this.#def(tx, id);
      return { items: await asg.listAssignments(tx, id) };
    });
  }

  slots(): Promise<{ items: ProcessSlot[] }> {
    return this.#read(async (tx) => {
      const rows = new Map((await asg.slotRows(tx)).map((r) => [r.slot, r]));
      const keys = (await asg.groupKeysSeen(tx)).map((key) => ({ key }));
      const all = [...new Set([...listSlots().map((s) => s.key), ...rows.keys()])].sort();
      const items = all.map((slot) => {
        const r = rows.get(slot);
        const label = listSlots().find((s) => s.key === slot)?.label ?? slot;
        const def = {
          default_def_id: r?.default_def_id ?? null,
          default_def_name: r?.default_def_name ?? null,
        };
        return { slot, label, ...def, group_keys: keys };
      });
      return { items };
    });
  }

  /** Đổi mặc định: def đã xuất bản, cùng khe; B2 trên mọi tenant bật gói chưa gán. */
  async setDefault(u: AuthUser, slot: string, defId: string): Promise<ProcessSlot> {
    specOrThrow(slot);
    await withConfigWrite(this.#w, u, async (tx) => {
      const def = await this.#publishedOf(tx, defId, slot);
      await this.#b2(tx, def, { defId: null, asDefault: true, tenantIds: [] });
      await asg.upsertSlotDefault(tx, { slot, defId, actorId: u.userId });
      return { result: null, audit: audit("set_default", def, { after: { slot } }) };
    });
    const items = (await this.slots()).items;
    return items.find((s) => s.slot === slot) as ProcessSlot;
  }

  async #publishedOf(tx: Tx, defId: string, slot: string): Promise<lib.LibRow> {
    const def = await lib.readLibDef(tx, defId);
    if (!def || def.slot !== slot) throw notFound();
    if (def.published_version === null) throw libError("PROCESS_NOT_PUBLISHED");
    const rel = await lib.readRelease(tx, defId, def.published_version);
    if (!rel) throw libError("PROCESS_NOT_PUBLISHED");
    // B2 kiểm bản ĐANG CHẠY (bản xuất bản), không phải nháp.
    return { ...def, stages: rel.stages, slot_body: rel.slot_body };
  }

  tenantSlots(tenantId: string): Promise<{ items: TenantProcessSlot[] }> {
    return this.#read(async (tx) => {
      if (!(await asg.tenantOf(tx, tenantId))) throw notFound();
      const rows = await asg.tenantSlotRows(
        tx,
        tenantId,
        listSlots().map((s) => s.key),
      );
      return { items: rows.map(toTenantSlot) };
    });
  }

  /** Gán (thay thế): def đã xuất bản của khe; tenant đủ Group theo mã ⇒ upsert một hàng (tenant, khe). */
  async assign(
    u: AuthUser,
    tenantId: string,
    slot: string,
    defId: string,
  ): Promise<TenantProcessSlot> {
    specOrThrow(slot);
    await withConfigWrite(this.#w, u, async (tx) => {
      if (!(await asg.tenantOf(tx, tenantId))) throw notFound();
      const def = await this.#publishedOf(tx, defId, slot);
      await this.#b2(tx, def, { defId: null, asDefault: false, tenantIds: [tenantId] });
      const prev = await asg.upsertAssignment(tx, { tenantId, slot, defId, actorId: u.userId });
      const a = audit("assign", def, {
        tenantId,
        before: { def_id: prev },
        after: { slot, def_id: defId },
      });
      return { result: null, audit: a };
    });
    return this.#tenantSlot(tenantId, slot);
  }

  async unassign(u: AuthUser, tenantId: string, slot: string): Promise<void> {
    await withConfigWrite(this.#w, u, async (tx) => {
      const prev = await asg.deleteAssignment(tx, tenantId, slot);
      if (prev === null) return { result: null, audit: null };
      const def = (await lib.readLibDef(tx, prev)) ?? { id: prev, key: "-" };
      const a = audit("unassign", def, { tenantId, before: { def_id: prev }, after: { slot } });
      return { result: null, audit: a };
    });
  }

  async #tenantSlot(tenantId: string, slot: string): Promise<TenantProcessSlot> {
    const { items } = await this.tenantSlots(tenantId);
    return items.find((s) => s.slot === slot) as TenantProcessSlot;
  }
}

async function freeKey(tx: Tx, key: string): Promise<string> {
  const base = key.slice(0, 28);
  const taken = await lib.libKeysLike(tx, `${base}-`);
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw defError("PROCESS_KEY_TAKEN", { field: "key" });
}

const toRelease = (r: lib.ReleaseRow): ProcessRelease => ({
  rel_version: Number(r.rel_version),
  name: r.name,
  published_at: r.published_at,
  published_by: r.published_by,
  note: r.note,
});

const toTenantSlot = (r: asg.TenantSlotRow): TenantProcessSlot => ({
  slot: r.slot,
  label: listSlots().find((s) => s.key === r.slot)?.label ?? r.slot,
  def_id: r.def_id,
  def_name: r.def_name,
  rel_version: r.rel_version === null ? null : Number(r.rel_version),
  is_default: r.is_default === true,
});
