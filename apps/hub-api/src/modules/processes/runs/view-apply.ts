// HUB-FR-129 · HUB-FR-130 · PC2-R16 · P-c2 · plan §6.6 · `StageView.apply` = hàng `autofix_applies` MỚI NHẤT của mỗi stage
// Áp (một query cho cả run, index `autofix_applies_stage_idx`). Chạy scope `system` SAU khi view đã kiểm quyền xem run;
// lọc `tenant_id` tường minh (cách ly tenant — R16). `test_log_file` chỉ khi attachment còn (purged_at null).
import type { ApplyStageView, AutofixFile } from "@ai/contracts/chat";
import type {
  ApplyErrorCode,
  ApplyMode,
  ApplyStatus,
  AutofixFailure,
  GitProvider,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { iso, type Snap } from "./view-steps";

const fileOf = (
  id: string | null,
  name: string | null,
  mime: string | null,
  size: string | number | null,
): AutofixFile | null =>
  id && name ? { id, name, mime: mime ?? "text/plain", size: Number(size ?? 0) } : null;

type Row = {
  stage_idx: number;
  mode: ApplyMode;
  status: ApplyStatus;
  branch: string | null;
  target_sha: string | null;
  head_sha: string | null;
  rebased: boolean;
  provider: GitProvider | null;
  pr_number: number | null;
  pr_url: string | null;
  auto_merge: "on" | "failed" | null;
  error_code: ApplyErrorCode | null;
  conflict_files: string[] | null;
  failures: AutofixFailure[] | null;
  test_exit_code: number | null;
  test_duration_ms: string | number | null;
  created_at: string;
  l_id: string | null;
  l_name: string | null;
  l_mime: string | null;
  l_size: string | number | null;
};

function toApplyView(r: Row): ApplyStageView {
  return {
    mode: r.mode,
    status: r.status,
    branch: r.branch,
    target_sha: r.target_sha,
    head_sha: r.head_sha,
    rebased: r.rebased,
    provider: r.provider,
    pr_number: r.pr_number === null ? null : Number(r.pr_number),
    pr_url: r.pr_url,
    auto_merge: r.auto_merge,
    error_code: r.error_code,
    conflict_files: Array.isArray(r.conflict_files) ? r.conflict_files : [],
    failures: Array.isArray(r.failures) ? r.failures : [],
    test_log_file: fileOf(r.l_id, r.l_name, r.l_mime, r.l_size),
    // M-test-field · {exit_code, duration_ms} khi job có chạy test (duration non-null); ngược lại null.
    test:
      r.test_duration_ms === null
        ? null
        : { exit_code: r.test_exit_code, duration_ms: Number(r.test_duration_ms) },
    created_at: r.created_at,
  };
}

/** stage_idx → view Áp mới nhất (stage không executor `apply` / chưa có hàng ⇒ không có khoá). */
export async function applyViews(
  tx: Tx,
  run: { id: string; tenantId: string },
  snap: Snap,
): Promise<Map<number, ApplyStageView>> {
  if (!snap.stages.some((s) => s.executor.kind === "apply")) return new Map();
  const rows = await tx.execute<Row>(sql`
    select distinct on (aa.stage_run_id) s.stage_idx, aa.mode, aa.status, aa.branch, aa.target_sha, aa.head_sha,
      aa.rebased, aa.provider, aa.pr_number, aa.pr_url, aa.auto_merge, aa.error_code, aa.conflict_files, aa.failures,
      aa.test_exit_code, aa.test_duration_ms,
      ${iso("aa.created_at")} as created_at,
      la.id as l_id, la.filename as l_name, la.mime as l_mime, la.size as l_size
    from hub.autofix_applies aa
    join hub.stage_runs s on s.id = aa.stage_run_id and s.tenant_id = aa.tenant_id
    left join hub.attachments la on la.id = aa.test_log_attachment_id and la.tenant_id = aa.tenant_id
      and la.purged_at is null
    where aa.process_run_id = ${run.id} and aa.tenant_id = ${run.tenantId}
    order by aa.stage_run_id, aa.created_at desc, aa.id desc`);
  const out = new Map<number, ApplyStageView>();
  for (const r of rows) {
    const i = Number(r.stage_idx);
    if (snap.stages[i]?.executor.kind === "apply") out.set(i, toApplyView(r));
  }
  return out;
}

/** Gắn `apply` vào `StageView` theo `idx`. */
export const withApply = <T extends { idx: number }>(
  stages: readonly T[],
  m: ReadonlyMap<number, ApplyStageView>,
): (T & { apply?: ApplyStageView })[] =>
  stages.map((s) => {
    const a = m.get(s.idx);
    return a ? { ...s, apply: a } : s;
  });
