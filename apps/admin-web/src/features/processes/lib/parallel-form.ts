// CR-125 · cr125-parallel-approval-ui · «A + B cùng duyệt»: bước Duyệt có `after.parallel` (2–5 nhóm nhận thẻ CÙNG LÚC; luật Tất cả / Một trong số /
// Ít nhất N). Bản nháp ⇄ `ApproveParallel` của contract, kiểm trực tiếp bằng `parallelStageIssues` (cùng luật với máy chủ), câu tóm tắt trên canvas.
// Thuần (không React).
import {
  type ApproveParallel,
  PARALLEL_GROUPS,
  PARALLEL_KEY,
  PARALLEL_LABEL_MAX,
  type ParallelRule,
  parallelStageIssues,
} from "@ai/contracts/hub-admin";

export { PARALLEL_GROUPS, PARALLEL_KEY, PARALLEL_LABEL_MAX };

/** Một nhóm cùng duyệt ở bản nháp: `groupId` rỗng = chưa chọn nhóm; `groupKey` chỉ có ở mẫu Thư viện (giữ nguyên khi lưu). */
export type ParallelGroupDraft = { groupId: string; groupKey?: string; label: string };
export type ParallelRuleKind = "all" | "any" | "min";
export type ParallelDraft = { groups: ParallelGroupDraft[]; rule: ParallelRuleKind; min: string };

export const emptyParallelGroup = (): ParallelGroupDraft => ({ groupId: "", label: "" });

/** Bật «cùng duyệt» từ bước Duyệt một nhóm: nhóm hiện có là nhóm đầu, thêm một nhóm trống; luật mặc định Tất cả. */
export function startParallel(first: { groupId: string; label: string }): ParallelDraft {
  return { groups: [{ ...first }, emptyParallelGroup()], rule: "all", min: "2" };
}

export function parallelFromDef(p: ApproveParallel): ParallelDraft {
  const rule = p.rule;
  return {
    groups: p.groups.map((g) => ({
      groupId: g.group_id ?? "",
      ...(g.group_key ? { groupKey: g.group_key } : {}),
      label: g.label,
    })),
    rule: typeof rule === "object" ? "min" : rule,
    min: typeof rule === "object" ? String(rule.min) : String(Math.max(2, p.groups.length)),
  };
}

const ruleOf = (d: ParallelDraft): ParallelRule =>
  d.rule === "min" ? { min: Math.trunc(Number(d.min)) || 1 } : d.rule;

/** Bản nháp → `after.parallel`. Mã nhóm (mẫu Thư viện) giữ `group_key`; bản công ty ghi `group_id` (`null` = chưa chọn nhóm). */
export function parallelToDef(d: ParallelDraft): ApproveParallel {
  return {
    groups: d.groups.map((g, i) => ({
      ...(g.groupKey ? { group_key: g.groupKey } : {}),
      ...(g.groupKey && !g.groupId ? {} : { group_id: g.groupId || null }),
      // nhãn bắt buộc 1–80 ký tự: chưa gõ ⇒ «Nhóm n» (không để lưu hỏng vì ô trống)
      label: g.label.trim() === "" ? `Nhóm ${i + 1}` : g.label.trim().slice(0, PARALLEL_LABEL_MAX),
    })),
    rule: ruleOf(d),
  } as ApproveParallel;
}

/** Số nhóm cần Đạt để bước Đạt (cho câu tóm tắt / ô «Ít nhất N»). */
export const parallelNeeded = (d: ParallelDraft): number =>
  d.rule === "all" ? d.groups.length : d.rule === "any" ? 1 : Math.trunc(Number(d.min)) || 1;

export type ParallelErrors = Record<string, string>;

/**
 * Lỗi hiện NGAY (không đợi Lưu), theo path của máy chủ: `stages.<i>.after.parallel.groups` / `.rule`.
 * `forEnable` ⇒ thêm «mỗi hàng phải chọn nhóm» (nhóm chưa chọn = không ai duyệt được).
 */
export function parallelErrors(
  stages: readonly { executor: string; parallel?: ParallelDraft | undefined }[],
  forEnable: boolean,
): ParallelErrors {
  const e: ParallelErrors = {};
  const shaped = stages.map((s) => ({
    executor: { kind: s.executor },
    after: {
      kind: "review",
      ...(s.parallel ? { parallel: parallelToDef(s.parallel) } : {}),
    },
  }));
  for (const i of parallelStageIssues(shaped)) e[i.path] = `${PARALLEL_KEY}.${i.rule}`;
  stages.forEach((s, i) => {
    if (!s.parallel || !forEnable) return;
    if (s.parallel.groups.some((g) => g.groupId === "" && !g.groupKey))
      e[`stages.${i}.after.parallel.groups`] ??= "process.admin.parallel.groupMissing";
  });
  return e;
}

/** Nhãn luật (khoá i18n `process.admin.parallel.rule.<tên>`) + tham số. */
export function ruleText(d: ParallelDraft): { key: string; params: { n: number } } {
  return { key: `process.admin.parallel.rule.${d.rule}`, params: { n: parallelNeeded(d) } };
}

/** «Trưởng bộ phận + Tài chính» — nhãn các nhóm (nhóm chưa có nhãn bỏ qua). */
export const parallelNames = (d: ParallelDraft): string =>
  d.groups
    .map((g) => g.label.trim())
    .filter(Boolean)
    .join(" + ");
