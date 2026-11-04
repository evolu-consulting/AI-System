// CR-118 · UW-FR-10/11 · cr118-flow-web · `<FlowPanel slot refId/>`: vẽ flow tại một khe theo `FlowView` — mỗi bước qua renderer của
// LOẠI bước (registry, lazy); lượt `mode=machine` qua `LegacyMachineRenderer`. Nguồn dữ liệu: runtime (HTTP kit hub) hoặc `view`
// do khe cấp (thẻ duyệt hiện có — không gọi thêm mạng). Trạng thái: đang tải / lỗi + Thử lại / không có lượt (không vẽ gì) / có.
import type { FlowFormValues, FlowView } from "@ai/contracts/flow";
import { type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useFlowSubmitForm, useFlowView } from "../hooks/use-flow";
import type { FlowRuntime } from "../port";
import { LegacyMachineRenderer } from "./Legacy";
import { rendererFor } from "./registry";
import type { StepContext, StepOverrides } from "./types";

export type FlowPanelProps = {
  slot: string;
  refId: string;
  runtime?: FlowRuntime | undefined;
  /** Nguồn do khe cấp (không gọi runtime): `null` = chưa có dữ liệu ⇒ không vẽ gì. */
  view?: FlowView | null | undefined;
  /** Renderer riêng của khe theo loại bước (đồng bộ). */
  overrides?: StepOverrides | undefined;
  /** Khung quanh danh sách bước (mặc định `<ol>`); khe tự thêm tiêu đề/liên kết. */
  frame?: ((steps: ReactNode, view: FlowView) => ReactNode) | undefined;
  /** Sau khi gửi form xong (khe tải lại dữ liệu riêng của nó). */
  onChanged?: (() => void) | undefined;
};

export type FlowPanelState =
  | { status: "loading" }
  | { status: "error"; onRetry: () => void }
  | { status: "ready"; view: FlowView | null };

type BodyProps = {
  state: FlowPanelState;
  slot: string;
  refId: string;
  overrides?: StepOverrides | undefined;
  frame?: FlowPanelProps["frame"];
  submitForm?: StepContext["submitForm"];
  now?: number;
};

const defaultFrame = (slot: string) => (steps: ReactNode) => (
  <ol data-flow-panel={slot}>{steps}</ol>
);

/** Phần trình bày thuần theo trạng thái (test render tĩnh được). */
export function FlowPanelBody(p: BodyProps) {
  const { t } = useTranslation();
  const { state } = p;
  if (state.status === "loading")
    return (
      <p data-flow="loading" role="status" className="mb-4 text-sm text-dim">
        {t("contracts.flowPanel.loading")}
      </p>
    );
  if (state.status === "error")
    return (
      <div data-flow="error" role="alert" className="mb-4 text-sm text-late">
        {t("contracts.flowPanel.error")}{" "}
        <button type="button" className="underline" onClick={state.onRetry}>
          {t("contracts.flowPanel.retry")}
        </button>
      </div>
    );
  const view = state.view;
  if (!view) return null;
  if (view.run?.mode === "machine") return <LegacyMachineRenderer view={view} />;
  if (view.steps.length === 0) return null;
  const ctx: StepContext = {
    slot: p.slot,
    refId: p.refId,
    view,
    now: p.now ?? Date.now(),
    taskOf: (key) => view.tasks.find((x) => x.step_key === key) ?? null,
    ...(p.submitForm ? { submitForm: p.submitForm } : {}),
  };
  const steps = view.steps.map((step) => {
    const R = rendererFor(step.kind, p.overrides);
    return (
      <Suspense
        key={step.key}
        fallback={<li data-flow="step-loading" aria-busy="true" className="py-2" />}
      >
        <R step={step} ctx={ctx} />
      </Suspense>
    );
  });
  return <>{(p.frame ?? defaultFrame(p.slot))(steps, view)}</>;
}

export function FlowPanel(p: FlowPanelProps) {
  const controlled = p.view !== undefined;
  const q = useFlowView({
    slot: p.slot,
    refId: p.refId,
    runtime: p.runtime,
    enabled: !controlled,
  });
  const submit = useFlowSubmitForm({
    slot: p.slot,
    refId: p.refId,
    runtime: p.runtime,
    onDone: p.onChanged,
  });
  const state: FlowPanelState = controlled
    ? { status: "ready", view: p.view ?? null }
    : q.isPending
      ? { status: "loading" }
      : q.isError
        ? { status: "error", onRetry: () => void q.refetch() }
        : { status: "ready", view: q.data ?? null };
  return (
    <FlowPanelBody
      state={state}
      slot={p.slot}
      refId={p.refId}
      overrides={p.overrides}
      frame={p.frame}
      submitForm={(taskId: string, values: FlowFormValues) =>
        submit.mutateAsync({ taskId, values })
      }
    />
  );
}
