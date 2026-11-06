// CR-121 c9 · R9 · Q8/Q9 · nghiệp vụ thư viện THEO CÔNG TY: (1) `cloneForCompany` — sao def thư viện (bản xuất bản) thành bản riêng
// của công ty `:tid` + tự gán thay bản cũ; (2) `view` — đọc chỉ-xem def thư viện + lượt chạy của công ty. Vai chốt Ở ĐÂY (route chỉ
// chặn member sớm): platform_admin mọi công ty · tenant_admin CHỈ công ty mình (khác ⇒ 404, không lộ tồn tại) · còn lại 403.
// Ghi qua `LibraryService.write` = `withConfigWrite` (scope system, khoá `config_meta` ⇒ hai admin cùng bấm tuần tự: người sau thấy bản đã có ⇒ 200
// `created:false`) trong MỘT transaction: sao + vào tập gán + đổi luật + audit. Không đọc/ghi gì ngoài công ty `:tid`.
import type { CloneForCompanyResponse, ProcessLibraryView } from "@ai/contracts/hub-admin";
import { PROCESS_LIBRARY_VIEW_RUNS_MAX } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { labelOf, runRecordLabels } from "../runs/run-record-labels";
import { listRuns, toSummary } from "../runs/runs.repo";
import * as lib from "./library.repo";
import type { LibraryService } from "./library.service";
import * as co from "./library-company.repo";
import { libError } from "./library-draft";
import * as rt from "./routing.repo";
import { releaseFromSet, tenantOf, upsertAssignment } from "./slot-assign.repo";
import { listSlots } from "./slots";

/** platform_admin mọi công ty; tenant_admin chỉ công ty mình (khác ⇒ 404); member/role khác ⇒ 403. */
export function companyAccess(u: AuthUser, tenantId: string): void {
  if (u.role === "platform_admin") return;
  if (u.role === "tenant_admin") {
    if (u.tenantId === tenantId) return;
    throw appError("NOT_FOUND");
  }
  throw appError("FORBIDDEN");
}

const notFound = () => appError("NOT_FOUND");
/** 23505 (postgres.js `code`, có thể nằm ở `cause` khi drizzle bọc lỗi). */
const isUniqueViolation = (e: unknown): boolean =>
  (e as { code?: string })?.code === "23505" ||
  (e as { cause?: { code?: string } })?.cause?.code === "23505";
const KEY_BASE_MAX = 50;
/** Xem được: còn sống, đã xuất bản, và là def thư viện (có khe HOẶC có `trigger` — flow theo sự kiện, CR-122). */
const slotLabel = (slot: string | null): string =>
  slot === null ? "" : (listSlots().find((s) => s.key === slot)?.label ?? slot);
const flowPart = (g: co.GlobalDef) => (g.trigger == null ? {} : { trigger: g.trigger, app: g.app });
const isViewable = (g: co.GlobalDef): g is co.GlobalDef & { published_version: number } =>
  !g.deleted && g.published_version !== null && (g.slot !== null || g.trigger != null);

export class CompanyLibraryService {
  constructor(
    private readonly d: Pick<ProcessDeps, "db">,
    private readonly svc: LibraryService,
  ) {}

  /** Sao + tự gán. `created:false` ⇒ bản riêng đã có (không ghi gì, không audit). */
  async cloneForCompany(
    u: AuthUser,
    tenantId: string,
    defId: string,
  ): Promise<CloneForCompanyResponse> {
    companyAccess(u, tenantId);
    try {
      return await this.#clone(u, tenantId, defId);
    } catch (e) {
      // Lưới cuối: UNIQUE `process_defs_company_copy_idx` (0103) chặn hai bản riêng cùng công ty × nguồn ⇒ coi như "đã có" (200).
      if (!isUniqueViolation(e)) throw e;
      const have = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
        co.companyCopyOf(tx, tenantId, defId),
      );
      if (!have) throw e;
      return {
        def_id: have.id,
        source_template_id: defId,
        rel_version: have.source_rel_version,
        created: false,
      };
    }
  }

  async #clone(u: AuthUser, tenantId: string, defId: string): Promise<CloneForCompanyResponse> {
    const { result } = await this.svc.write(u, async (tx) => {
      const src = await this.#libSource(tx, tenantId, defId);
      const have = await co.companyCopyOf(tx, tenantId, src.id);
      if (have) {
        const done = {
          def_id: have.id,
          source_template_id: src.id,
          rel_version: have.source_rel_version,
        };
        return { result: { ...done, created: false }, audit: null };
      }
      const rel = await lib.readRelease(tx, src.id, src.published_version);
      if (!rel) throw libError("PROCESS_NOT_PUBLISHED");
      const key = await co.freeCompanyKey(tx, tenantId, `${src.key.slice(0, KEY_BASE_MAX)}-copy`);
      const newId = await co.insertCompanyCopy(tx, {
        src: src.id,
        tenantId,
        key,
        name: rel.name,
        stages: rel.stages,
        slotBody: rel.slot_body,
        relVersion: src.published_version,
        actorId: u.userId,
      });
      // flow (không khe) gán qua company_flows, không có luật khe để chuyển
      const moved =
        src.slot === null
          ? 0
          : await this.#assign(tx, {
              tenantId,
              slot: src.slot,
              from: src.id,
              to: newId,
              actorId: u.userId,
            });
      const done = {
        def_id: newId,
        source_template_id: src.id,
        rel_version: src.published_version,
      };
      const audit = {
        tenantId,
        action: "copy" as const,
        entity: "process_def" as const,
        entityId: newId,
        entityName: key,
        before: null,
        after: {
          from: src.id,
          slot: src.slot,
          rel_version: src.published_version,
          rules_moved: moved,
        },
        summary: { key, from: src.key },
      };
      return { result: { ...done, created: true }, audit };
    });
    return result;
  }

  /** Công ty có; nguồn là def thư viện còn sống (khác ⇒ 404 không lộ tồn tại; không khe ⇒ `NOT_LIBRARY_DEF`; khe hết đăng ký ⇒ `SLOT_GONE`; chưa xuất bản ⇒ `PROCESS_NOT_PUBLISHED`). */
  async #libSource(tx: Tx, tenantId: string, defId: string) {
    if (!(await tenantOf(tx, tenantId))) throw notFound();
    const src = await co.readGlobalDef(tx, defId);
    if (!src || src.deleted) throw notFound();
    const slot = src.slot;
    // flow theo sự kiện (CR-122): không khe nhưng có `trigger` ⇒ vẫn là def thư viện
    if (slot === null && src.trigger == null) throw libError("NOT_LIBRARY_DEF");
    if (slot !== null && !listSlots().some((s) => s.key === slot))
      throw libError("SLOT_GONE", { slot });
    if (src.published_version === null) throw libError("PROCESS_NOT_PUBLISHED");
    return { ...src, slot, published_version: src.published_version };
  }
  /**
   * Tự gán thay bản cũ (Q9): khoá đầu luật; mọi luật trỏ ĐÚNG `from` ⇒ trỏ `to` (luật khác giữ nguyên); `from` ra khỏi tập gán nếu
   * hết luật dùng. Công ty đang chạy đúng mẫu khe (chưa có luật mặc định) ⇒ tạo luật mặc định = bản riêng. Trả số luật đổi/tạo.
   */
  async #assign(
    tx: Tx,
    w: { tenantId: string; slot: string; from: string; to: string; actorId: string },
  ): Promise<number> {
    const head = await rt.readRouting(tx, w.tenantId, w.slot, true); // FOR UPDATE đầu luật (tuần tự với PUT luật)
    const hasRules = head.rules.some((r) => r.def_id === w.from);
    if (hasRules) {
      await rt.insertAssigned(tx, {
        tenantId: w.tenantId,
        slot: w.slot,
        defId: w.to,
        actorId: w.actorId,
      });
      const n = await co.repointRules(tx, w);
      await co.bumpRoutingHead(tx, w);
      await releaseFromSet(tx, { tenantId: w.tenantId, slot: w.slot, defId: w.from });
      return n;
    }
    const noDefault = !head.rules.some((r) => r.is_default);
    if (noDefault && (await co.slotDefaultOf(tx, w.slot)) === w.from) {
      await upsertAssignment(tx, {
        tenantId: w.tenantId,
        slot: w.slot,
        defId: w.to,
        actorId: w.actorId,
      });
      return 1;
    }
    return 0;
  }

  /** Chỉ-xem: bản xuất bản + lượt chạy gần nhất của công ty. Chưa xuất bản / không phải def thư viện / đã xoá ⇒ 404. */
  async view(u: AuthUser, tenantId: string, defId: string): Promise<ProcessLibraryView> {
    companyAccess(u, tenantId);
    return withHubScope(
      this.d.db,
      { kind: "system" },
      async (tx) => {
        if (!(await tenantOf(tx, tenantId))) throw notFound();
        const g = await co.readGlobalDef(tx, defId);
        // thư viện = có khe HOẶC có `trigger` (flow theo sự kiện, CR-122)
        if (!g || !isViewable(g)) throw notFound();
        const rel = await lib.readRelease(tx, g.id, g.published_version);
        if (!rel) throw notFound();
        const copy = await co.companyCopyOf(tx, tenantId, g.id);
        const rows = await listRuns(tx, {
          tenantId,
          defIds: copy ? [g.id, copy.id] : [g.id],
          limit: PROCESS_LIBRARY_VIEW_RUNS_MAX,
        });
        const slot = g.slot;
        const page = rows.slice(0, PROCESS_LIBRARY_VIEW_RUNS_MAX);
        const labels = await runRecordLabels(tenantId, page);
        return {
          read_only: true as const,
          def_id: g.id,
          slot,
          slot_label: slotLabel(slot),
          ...flowPart(g),
          name: rel.name,
          description: g.description,
          rel_version: Number(g.published_version),
          stages: rel.stages,
          slot_body: rel.slot_body,
          company_copy: copy ? { def_id: copy.id, rel_version: copy.source_rel_version } : null,
          // c11b: nhãn hồ sơ (mã HĐ thật) theo TẬP, cùng nguồn với GET /process-runs
          runs: page.map((r) => ({ ...toSummary(r), record_label: labelOf(labels, r) })),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
}
