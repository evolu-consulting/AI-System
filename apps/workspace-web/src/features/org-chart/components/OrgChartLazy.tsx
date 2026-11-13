// CR-142 · nạp sơ đồ cây bằng React.lazy (chunk riêng: xyflow không phình trang khác). Lỗi nạp ⇒ báo + «Thử lại».
import type { OrgChartProps } from "@ai/flow-canvas";
import { Component, lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const load = () => import("@ai/flow-canvas").then((m) => ({ default: m.OrgChart }));

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

export function OrgChartLazy(p: OrgChartProps) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt chủ ý tạo lại lazy
  const Chart = useMemo(() => lazy(load), [attempt]);
  return (
    <Boundary
      key={attempt}
      fallback={() => (
        <p role="alert" className="text-sm text-late">
          {t("contracts.orgChart.chartLoadFail")}{" "}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
            {t("contracts.orgChart.retry")}
          </button>
        </p>
      )}
    >
      <Suspense
        fallback={
          <p role="status" className="text-sm text-dim">
            {t("contracts.common.loading")}
          </p>
        }
      >
        <Chart {...p} />
      </Suspense>
    </Boundary>
  );
}
