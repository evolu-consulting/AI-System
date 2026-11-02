// CR-106 · nạp canvas bằng React.lazy (chunk `flow-canvas`). Đang tải ⇒ báo trạng thái; nạp lỗi ⇒ báo + "Thử lại".
import { Component, lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FlowCanvasProps } from "./FlowCanvas";

/** Tạo lại `lazy` mỗi lần thử (promise lỗi của `lazy` bị cache). */
const load = () => import(/* webpackChunkName: "flow-canvas" */ "./FlowCanvas");

class Boundary extends Component<
  { fallback: () => ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback() : this.props.children;
  }
}

export function FlowCanvasLazy(p: FlowCanvasProps) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt chủ ý tạo lại lazy
  const Canvas = useMemo(() => lazy(load), [attempt]);
  return (
    <Boundary
      key={attempt}
      fallback={() => (
        <p role="alert" className="mb-4 text-late">
          {t("contracts.flow.current.canvas.loadFail")}{" "}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
            {t("contracts.common.retry")}
          </button>
        </p>
      )}
    >
      <Suspense
        fallback={
          <p role="status" className="mb-4 text-dim">
            {t("contracts.common.loading")}
          </p>
        }
      >
        <Canvas {...p} />
      </Suspense>
    </Boundary>
  );
}
