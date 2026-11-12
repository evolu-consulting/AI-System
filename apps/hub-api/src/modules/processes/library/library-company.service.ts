// CR-121 c9 · R9 · nghiệp vụ thư viện THEO CÔNG TY: `view` — đọc chỉ-xem def thư viện + lượt chạy của công ty (CR-127 · Z5: đã gỡ
// "sao chép cho công ty" — chỉ quản trị nền tảng soạn quy trình). Vai chốt Ở ĐÂY (route chỉ chặn member sớm): platform_admin mọi công ty ·
// tenant_admin CHỈ công ty mình (khác ⇒ 404, không lộ tồn tại) · còn lại 403.
import type { ProcessLibraryView } from "@ai/contracts/hub-admin";
import { PROCESS_LIBRARY_VIEW_RUNS_MAX } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { claimError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { labelOf, runRecordLabels } from "../runs/run-record-labels";
import { listRuns, toSummary } from "../runs/runs.repo";
import * as lib from "./library.repo";
import type { LibraryService } from "./library.service";
import * as co from "./library-company.repo";
import { tenantOf } from "./slot-assign.repo";
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

/**
 * CR-127 · E8 · BR-10/11: GHI quy trình công ty chỉ quản trị nền tảng. Vai kiểm như `companyAccess` (member 403, công ty khác 404)
 * rồi quản trị công ty (đúng công ty) ⇒ 403 `FORBIDDEN_TENANT_ADMIN_WRITE`. Route đã chặn sớm; đây là lưới thứ hai.
 */
export function assertPlatformWrite(u: AuthUser, tenantId: string): void {
  companyAccess(u, tenantId);
  if (u.role !== "platform_admin") throw claimError("FORBIDDEN_TENANT_ADMIN_WRITE");
}

const notFound = () => appError("NOT_FOUND");
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
