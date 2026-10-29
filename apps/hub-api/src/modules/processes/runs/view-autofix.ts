// HUB-FR-128 · HUB-FR-130 · PC-R09/R14 · P-c1 · plan §3.4, §6.5: `StageView.autofix` = kết quả tự-sửa MỚI NHẤT của mỗi stage có
// cấu hình `autofix` (một query cho cả run, index `autofix_results_run_idx` + `_stage_idx`). Chạy scope `system` SAU khi
// view đã kiểm quyền xem run (definer `process_run_viewer`) — RLS `attachments` scope user chỉ thấy file của chính mình,
// mà diff/log thuộc người bắt đầu ⇒ lọc `tenant_id` tường minh mọi bảng. `pin_sha` chỉ khi pin git_remote (không lộ path).
import type { AutofixFile, AutofixStageView } from "@ai/contracts/chat";
import {
  type AutofixDiffStats,
  type AutofixFailure,
  type AutofixStatus,
  effectiveApplyMode,
  hasNodeFamily,
  type SourceKind,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { iso, type Snap } from "./view-steps";

type Row = {
  stage_idx: number;
  source_key: string;
  pin: { kind?: string; sha?: string } | null;
  branch: string;
  round: number;
  status: AutofixStatus;
  diff_stats: AutofixDiffStats | null;
  failures: AutofixFailure[] | null;
  test_exit_code: number | null;
  test_duration_ms: number | null;
  created_at: string;
  d_id: string | null;
  d_name: string | null;
  d_mime: string | null;
  d_size: string | number | null;
  l_id: string | null;
  l_name: string | null;
  l_mime: string | null;
  l_size: string | number | null;
};

const fileOf = (
  id: string | null,
  name: string | null,
  mime: string | null,
  size: string | number | null,
): AutofixFile | null =>
  id && name ? { id, name, mime: mime ?? "text/plain", size: Number(size ?? 0) } : null;

export function toAutofixView(r: Row): AutofixStageView {
  return {
    source_key: r.source_key,
    pin_sha: r.pin?.kind === "git_remote" && typeof r.pin.sha === "string" ? r.pin.sha : null,
    branch: r.branch,
    round: Number(r.round),
    status: r.status,
    diff_stats: r.diff_stats ?? null,
    diff_file: fileOf(r.d_id, r.d_name, r.d_mime, r.d_size),
    test_log_file: fileOf(r.l_id, r.l_name, r.l_mime, r.l_size),
    test:
      r.test_duration_ms === null
        ? null
        : { exit_code: r.test_exit_code, duration_ms: Number(r.test_duration_ms) },
    failures: Array.isArray(r.failures) ? r.failures : [],
    created_at: r.created_at,
    // C7/C43/C9 · Hub LUÔN gửi (null khi def không có stage Áp); enrich ở `autofixViews`.
    apply_mode: null,
    apply_base: null,
  };
}

type SrcCfg = {
  kind: SourceKind;
  url?: string;
  branch?: string;
  apply_mode?: "pr" | "auto_merge" | "branch_only";
};

/** C7/C43/C9 · def có stage Áp ⇒ `apply_mode`=`effectiveApplyMode(nguồn hiện tại)`, `apply_base`=branch khi git_remote. */
async function enrichApplyMode(
  tx: Tx,
  run: { tenantId: string },
  out: Map<number, AutofixStageView>,
): Promise<void> {
  const keys = [...new Set([...out.values()].map((v) => v.source_key))];
  if (keys.length === 0) return;
  const rows = await tx.execute<{ key: string; config: SrcCfg }>(sql`select key, config
    from hub.sources where tenant_id = ${run.tenantId} and deleted_at is null
      and key in (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )})`);
  const byKey = new Map(rows.map((r) => [r.key, r.config] as const));
  for (const [i, v] of out) {
    const cfg = byKey.get(v.source_key);
    if (!cfg) continue;
    out.set(i, {
      ...v,
      apply_mode: effectiveApplyMode(cfg),
      apply_base: cfg.kind === "git_remote" ? (cfg.branch ?? null) : null,
    });
  }
}

/** stage_idx → view tự-sửa mới nhất (stage không cấu hình `autofix` / chưa có kết quả ⇒ không có khoá). */
export async function autofixViews(
  tx: Tx,
  run: { id: string; tenantId: string },
  snap: Snap,
): Promise<Map<number, AutofixStageView>> {
  if (!snap.stages.some((s) => s.autofix)) return new Map();
  const rows = await tx.execute<Row>(sql`
    select distinct on (ar.stage_run_id) s.stage_idx, ar.source_key, ar.pin, ar.branch, ar.round, ar.status,
      ar.diff_stats, ar.failures, ar.test_exit_code, ar.test_duration_ms, ${iso("ar.created_at")} as created_at,
      da.id as d_id, da.filename as d_name, da.mime as d_mime, da.size as d_size,
      la.id as l_id, la.filename as l_name, la.mime as l_mime, la.size as l_size
    from hub.autofix_results ar
    join hub.stage_runs s on s.id = ar.stage_run_id and s.tenant_id = ar.tenant_id
    left join hub.attachments da on da.id = ar.diff_attachment_id and da.tenant_id = ar.tenant_id
      and da.purged_at is null
    left join hub.attachments la on la.id = ar.test_log_attachment_id and la.tenant_id = ar.tenant_id
      and la.purged_at is null
    where ar.process_run_id = ${run.id} and ar.tenant_id = ${run.tenantId}
    order by ar.stage_run_id, ar.created_at desc, ar.id desc`);
  const out = new Map<number, AutofixStageView>();
  for (const r of rows) {
    const i = Number(r.stage_idx);
    if (snap.stages[i]?.autofix) out.set(i, toAutofixView(r));
  }
  if (hasNodeFamily(snap.stages, "apply")) await enrichApplyMode(tx, run, out);
  return out;
}

/** Gắn `autofix` vào `StageView` theo `idx`. */
export const withAutofix = <T extends { idx: number }>(
  stages: readonly T[],
  m: ReadonlyMap<number, AutofixStageView>,
): (T & { autofix?: AutofixStageView })[] =>
  stages.map((s) => {
    const af = m.get(s.idx);
    return af ? { ...s, autofix: af } : s;
  });

/** PC-R14 · view task: chỉ giữ autofix của stage có task duyệt của chính người xem (không lộ diff stage khác). */
export const onlyMyReviewStages = (
  all: ReadonlyMap<number, AutofixStageView>,
  myTasks: readonly { kind: string; stage_idx: number }[],
): Map<number, AutofixStageView> => {
  const mine = new Set(myTasks.filter((t) => t.kind === "review").map((t) => t.stage_idx));
  return new Map([...all].filter(([i]) => mine.has(i)));
};
