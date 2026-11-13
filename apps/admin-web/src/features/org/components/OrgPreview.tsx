// CR-142 · xem trước sơ đồ cây ở «Cơ cấu» (cùng component với Sổ Hợp Tác, nạp lười). Bấm thẻ phòng ⇒ chọn phòng đó ở form bên dưới.
import type { OrgChartDept } from "@ai/flow-canvas/pure";
import { Component, lazy, type ReactNode, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

const Chart = lazy(() => import("@ai/flow-canvas").then((m) => ({ default: m.OrgChart })));

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Props = {
  depts: readonly OrgChartDept[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function OrgPreview({ depts, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const labels = useMemo(
    () => ({
      noHead: t("orgEdit.noHead"),
      people: (count: number) => t("orgEdit.people", { count }),
      canvas: t("orgEdit.chart"),
      controls: {
        title: t("orgEdit.controls"),
        zoomIn: t("orgEdit.zoomIn"),
        zoomOut: t("orgEdit.zoomOut"),
        fit: t("orgEdit.fit"),
      },
    }),
    [t],
  );
  return (
    <div data-testid="org-preview" className="space-y-1">
      <p className="text-sm text-muted-foreground">{t("orgEdit.preview")}</p>
      <Boundary
        fallback={
          <p role="alert" className="text-sm text-destructive">
            {t("orgEdit.chartFail")}
          </p>
        }
      >
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted-foreground">
              {t("orgEdit.chartLoading")}
            </p>
          }
        >
          <Chart
            depts={depts}
            rootName={t("orgEdit.company")}
            labels={labels}
            selectedId={selectedId}
            onSelectDept={onSelect}
            className="h-[min(60vh,480px)] min-h-[280px] w-full rounded-lg border bg-background"
          />
        </Suspense>
      </Boundary>
    </div>
  );
}
