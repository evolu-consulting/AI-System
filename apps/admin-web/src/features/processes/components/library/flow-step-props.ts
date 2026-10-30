// CR-105 · L3: kiểu props dùng chung của các trường bước Form (tách khỏi FlowStepCard để FlowEsignFields không import vòng).
export type GroupOption = { key: string; label?: string };
export type StepFieldProps<S> = {
  id: string;
  step: S;
  groups: readonly GroupOption[];
  err: (field: string) => string | undefined;
  onPatch: (p: Partial<S>) => void;
};
