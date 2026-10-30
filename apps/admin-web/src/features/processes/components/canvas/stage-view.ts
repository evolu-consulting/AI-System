// ADM-FR-71 · P-b2 (plan-frontend FB5/§6): mô hình hiển thị một giai đoạn cho canvas/StepList — dẫn xuất THUẦN từ bản nháp,
// chỉ chứa thứ cần vẽ (gõ `instruction` không đổi mô hình ⇒ canvas không dựng lại).
import type { FlowWhen } from "@ai/contracts";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { branchOff } from "../../lib/d2-validate";
import type { DraftErrors, StageDraft } from "../../lib/def-form";
import { isIf } from "../../lib/if-form";
import { describeWhen } from "../../lib/library-list";
import { isSlotStep, isSystemStage } from "../../lib/system-nodes";

export type StageView = {
  uid: string;
  /** Chỉ số trong mảng (nhãn "Giai đoạn n" = index + 1). */
  index: number;
  step: number;
  name: string;
  executor: string;
  after: "review" | "auto";
  real: boolean;
  backTo: number[];
  /** P-c1 · stage tự-sửa mã (huy hiệu). */
  autofix: boolean;
  /** P-c2 · stage "Áp bản sửa" (huy hiệu). */
  apply: boolean;
  /** P-d1 · stage "Chờ tới ngày" (huy hiệu). */
  wait: boolean;
  /** P-d2 · stage "Gọi tool" + tool có tác dụng phụ (huy hiệu). */
  tool: boolean;
  sideEffect: boolean;
  /** P-d2 · bước đích (0-based) của từng luật rẽ nhánh; null = chưa chọn. */
  branch: (number | null)[];
  /** CR-103 · node If: bước Đúng / Sai (0-based; null = chưa chọn / Sai ⇒ bước kế); stage khác ⇒ null. */
  ifs: { yes: number | null; no: number | null } | null;
  hasError: boolean;
  /** CR-105 · nút hệ thống của khe (contracts-route/finalize): khoá, không xoá/đổi/kéo. */
  locked: boolean;
  /** CR-105 UX · nút hệ thống hiện thành viên thuốc xám: chọn bước kế / hoàn tất; stage khác ⇒ null. */
  sys: "route" | "finalize" | null;
  /** CR-105 UX · bước duyệt của khe: số thứ tự (chỉ đếm bước duyệt), phòng ban, hạn, điều kiện bằng lời; stage khác ⇒ null. */
  slotInfo: { no: number; dept: string; dueH: number | null; cond: string | null } | null;
  /** fnr-canvas · `y` đã lưu của node (`ui.y`); null = bố cục tự động. */
  y: number | null;
};

const hasStageError = (errors: DraftErrors, i: number): boolean =>
  Object.keys(errors).some((k) => k.startsWith(`stages.${i}.`));

/** CR-103 · node If: bước Đúng / Sai (0-based) cho canvas; stage khác ⇒ null. */
const ifsOf = (s: StageDraft): StageView["ifs"] =>
  isIf(s)
    ? {
        yes: s.ifx.yes === null ? null : s.ifx.yes - 1,
        no: s.ifx.no === null ? null : s.ifx.no - 1,
      }
    : null;

const sysKind = (s: StageDraft): StageView["sys"] =>
  !isSystemStage(s) ? null : s.tool.key === "contracts-finalize" ? "finalize" : "route";

function slotInfoOf(s: StageDraft, all: readonly StageDraft[]): StageView["slotInfo"] {
  if (!isSlotStep(s)) return null;
  const slot = s.slotRaw ?? {};
  const no = all.filter(isSlotStep).indexOf(s) + 1;
  const due = slot.due_h;
  return {
    no,
    dept: String(slot.department_group_key ?? ""),
    dueH: typeof due === "number" ? due : null,
    cond: describeWhen(slot.when as FlowWhen | null | undefined),
  };
}

/** Nhãn người thực hiện: bước của khe (CR-105) hiện mã phòng ban thay cho tên tool route; còn lại theo agent/nhóm/tool. */
function executorLabel(
  s: StageDraft,
  labels: ReadonlyMap<string, string>,
  tools: ReadonlyMap<string, { name: string }>,
): string {
  if (isSlotStep(s)) return String(s.slotRaw?.department_group_key ?? "");
  if (s.executor === "set") return "set";
  if (s.executor === "tool") return tools.get(s.tool.key)?.name ?? s.tool.key;
  return labels.get(s.executor) ?? "";
}

export function stageViews(
  stages: readonly StageDraft[],
  errors: DraftErrors,
  refs: Pick<EditorRefs, "agents" | "teams" | "tools">,
): StageView[] {
  const labels = new Map([...refs.agents, ...refs.teams].map((o) => [o.value, o.label]));
  const tools = new Map((refs.tools ?? []).map((t) => [t.key, t]));
  return stages.map((s, i) => ({
    uid: s.uid,
    index: i,
    step: s.step,
    name: s.name,
    executor: executorLabel(s, labels, tools),
    after: s.after,
    real: s.real,
    backTo: s.backTo,
    autofix: s.autofix.on,
    apply: s.executor === "apply",
    wait: s.executor === "wait_until",
    tool: s.executor === "tool" && !isSlotStep(s),
    sideEffect:
      s.executor === "tool" && !isSlotStep(s) && tools.get(s.tool.key)?.side_effect === true,
    branch: branchOff(s) ? [] : s.branch.map((b) => (b.goto === null ? null : b.goto - 1)),
    ifs: ifsOf(s),
    hasError: hasStageError(errors, i),
    locked: isSystemStage(s),
    sys: sysKind(s),
    slotInfo: slotInfoOf(s, stages),
    y: s.uiY ?? null,
  }));
}

/** Hai mô hình có cùng nội dung hiển thị (dùng cho `memo` của node). */
export const sameView = (a: StageView, b: StageView): boolean =>
  a.uid === b.uid &&
  a.index === b.index &&
  a.step === b.step &&
  a.name === b.name &&
  a.executor === b.executor &&
  a.after === b.after &&
  a.real === b.real &&
  a.autofix === b.autofix &&
  a.apply === b.apply &&
  a.wait === b.wait &&
  a.tool === b.tool &&
  a.sideEffect === b.sideEffect &&
  a.branch.join() === b.branch.join() &&
  `${a.ifs?.yes}:${a.ifs?.no}` === `${b.ifs?.yes}:${b.ifs?.no}` &&
  a.hasError === b.hasError &&
  a.locked === b.locked &&
  a.sys === b.sys &&
  JSON.stringify(a.slotInfo) === JSON.stringify(b.slotInfo) &&
  a.y === b.y &&
  a.backTo.join() === b.backTo.join();

/** CR-105 UX · quy trình khe: ẩn cạnh "Quay lại" và nhãn "Rẽ nhánh" (Hub biên dịch lại; người dùng chỉ thấy chuỗi bước duyệt). */
export const withoutSlotLinks = (views: StageView[]): StageView[] =>
  views.map((v) => ({ ...v, backTo: [], branch: [] }));
