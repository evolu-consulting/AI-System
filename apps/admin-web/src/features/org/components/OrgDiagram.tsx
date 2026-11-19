// CR-142 · CR-189 · sơ đồ cây ở «Cơ cấu» — CHẾ ĐỘ SỬA TRỰC TIẾP (cùng component với Sổ Hợp Tác, nạp lười): «+» thêm phòng con, bấm tên đổi tên,
// «⋯» thao tác khác, kéo thả (máy tính) để chuyển phòng cha. Chữ do host cấp (i18n).
import type { OrgChartDept, OrgChartEdit } from "@ai/flow-canvas";
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
  edit: OrgChartEdit;
};

export function OrgDiagram({ depts, edit }: Props) {
  const { t } = useTranslation();
  const labels = useMemo(
    () => ({
      noHead: t("orgEdit.noHead"),
      people: (count: number) => t("orgEdit.people", { count }),
      peopleTotal: (count: number) => t("orgEdit.peopleTotal", { count }),
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
      {edit.touch ? null : (
        <p className="text-xs text-muted-foreground" data-testid="org-drag-hint">
          {t("orgEdit.dragHint")}
        </p>
      )}
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
            edit={edit}
            className="h-[min(70vh,560px)] min-h-[320px] w-full rounded-lg border bg-background"
          />
        </Suspense>
      </Boundary>
    </div>
  );
}
