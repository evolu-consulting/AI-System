// CR-112 · ADM-FR-79 · luật thuần của wizard onboard 4 bước (Q12): trạng thái nằm trên URL (`?tenant=<id>&step=N`) nên tải lại
// hoặc bỏ ngang vẫn tiếp được. Bước 1 tạo công ty ngay (không giao dịch xuyên bước); bước 3/4 bỏ qua được.
export const WIZARD_STEPS = ["company", "apps", "people", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Thứ tự 1..4 của bước (dùng cho `?step=`). */
export const stepNumber = (s: WizardStep): number => WIZARD_STEPS.indexOf(s) + 1;

export type WizardSearch = { tenant?: string; step?: number };

/** Chỉ bước 3 (Phân quyền, Người dùng) và 4 (Xem lại) bỏ qua được; bước 1, 2 là việc chính. */
const SKIPPABLE: readonly WizardStep[] = ["people", "review"];
export const isSkippable = (s: WizardStep): boolean => SKIPPABLE.includes(s);

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Viết tay (không zod) vì `validateSearch` nằm trong bundle ban đầu (cùng lý do `workspace-search.ts`). */
export function validateWizardSearch(s: Record<string, unknown>): WizardSearch {
  const n = Number(s.step);
  return {
    tenant: str(s.tenant),
    step: Number.isInteger(n) && n >= 1 && n <= WIZARD_STEPS.length ? n : undefined,
  };
}

/**
 * Bước hiện tại. Chưa có công ty ⇒ luôn bước 1 (mọi bước sau cần công ty); có công ty mà thiếu/chỉ bước 1 ⇒ bước 2
 * (công ty đã tạo, không tạo lại).
 */
export function resolveStep(search: WizardSearch): WizardStep {
  if (!search.tenant) return "company";
  const n = Math.max(search.step ?? 2, 2);
  return WIZARD_STEPS[n - 1] ?? "apps";
}

/** Bước kế; bước cuối ⇒ `null` (kết thúc, sang workspace). */
export function nextStep(s: WizardStep): WizardStep | null {
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(s) + 1] ?? null;
}

/** Bước trước; không lùi về bước 1 khi công ty đã tạo (tạo lại là sai), nên tối thiểu là "apps". */
export function prevStep(s: WizardStep): WizardStep | null {
  const i = WIZARD_STEPS.indexOf(s);
  return i > 1 ? (WIZARD_STEPS[i - 1] ?? null) : null;
}

/** Trạng thái hiển thị của từng chấm trên thanh bước. */
export type StepState = "done" | "current" | "todo";
export function stepStates(current: WizardStep): StepState[] {
  const at = WIZARD_STEPS.indexOf(current);
  return WIZARD_STEPS.map((_, i) => (i < at ? "done" : i === at ? "current" : "todo"));
}

/** Search của wizard cho một công ty đã có ("Onboard lại" mở từ bước 2, Q13). */
export const onboardAgainSearch = (tenantId: string): Required<WizardSearch> => ({
  tenant: tenantId,
  step: 2,
});
