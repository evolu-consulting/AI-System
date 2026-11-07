// CR-123 · p25 · cạnh "nhảy bước": bước có "Sau đó đi tiếp" (`nextStep`) khác bước kế ⇒ vẽ cạnh tới bước đó THAY cho cạnh tới bước kế,
// để kéo nối / nối lại / xoá cạnh trên canvas nhìn thấy kết quả. Chỉ áp cho bước đứng một mình trong cột (cột song song đi qua nút gộp).
import type { LayoutEdge } from "@ai/flow-canvas/pure";

export type JumpStage = {
  uid: string;
  step: number;
  /** Node Nếu (có Đúng/Sai riêng) — không có "đi tiếp". */
  isIf: boolean;
  nextStep: number | undefined;
  /** Bước Kết thúc / chờ sự kiện — không có "đi tiếp". */
  terminal: boolean;
};

export function applyJumps(
  stages: readonly JumpStage[],
  edges: readonly LayoutEdge[],
): LayoutEdge[] {
  const col = (step: number) => stages.filter((s) => s.step === step);
  const jumps = stages.filter(
    (s) =>
      !s.isIf &&
      !s.terminal &&
      s.nextStep !== undefined &&
      s.nextStep > s.step &&
      s.nextStep !== s.step + 1 &&
      col(s.step).length === 1 &&
      col(s.nextStep).length > 0,
  );
  if (jumps.length === 0) return [...edges];
  const from = new Set(jumps.map((s) => s.uid));
  const kept = edges.filter((e) => !(from.has(e.source) && e.kind === "forward"));
  const added = jumps.flatMap((s) =>
    col(s.nextStep as number).map(
      (t): LayoutEdge => ({
        id: `${s.uid}>${t.uid}`,
        source: s.uid,
        target: t.uid,
        kind: "forward",
      }),
    ),
  );
  return [...kept, ...added];
}
