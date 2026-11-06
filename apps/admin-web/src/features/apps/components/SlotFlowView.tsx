// CR-118 · cr118-app-config · sơ đồ + bảng bước CHỈ ĐỌC của quy trình mặc định của khe (Bắt đầu → các bước → Ghi Đã duyệt, nút hệ thống khoá).
// Sửa luôn ở ProcessEditorPage ("Xem sơ đồ" / "Nhân bản để sửa" ở thẻ khe). CR-118 · cr118-flow-canvas: sơ đồ vẽ bằng gói dùng chung `@ai/flow-canvas` (lười), bảng bước giữ ở đây.
import { Component, lazy, type ReactNode, Suspense, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSlotFlow } from "../hooks/use-slot-flow";
import type { StepRow, StepWho } from "../lib/flow-view";

function useWho() {
  const { t } = useTranslation();
  return useCallback(
    (w: StepWho): string => {
      switch (w.type) {
        case "group":
          return w.key
            ? `${w.key}${w.headOnly ? ` · ${t("appcfg.flow.headOnly")}` : ""}`
            : t("appcfg.flow.noGroup");
        case "workflow":
          return t("appcfg.flow.workflow", { key: w.key });
        case "notify":
          return [
            w.creator ? t("appcfg.flow.notifyTo.creator") : null,
            w.owner ? t("appcfg.flow.notifyTo.owner") : null,
            w.group,
          ]
            .filter(Boolean)
            .join(", ");
        case "wait":
          return t("appcfg.flow.waitWho");
        default:
          return t(`appcfg.flow.signer.${w.type}`);
      }
    },
    [t],
  );
}

/** Gói sơ đồ (xyflow) nặng ⇒ nạp lười; lỗi nạp ⇒ báo như khi chưa hiển thị được. Tạo `lazy` một lần (promise lỗi bị cache). */
const SlotFlowDiagram = lazy(
  () => import(/* webpackChunkName: "canvas-slot" */ "./SlotFlowDiagram"),
);

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

function Diagram({ rows, who }: { rows: StepRow[]; who: (w: StepWho) => string }) {
  const { t } = useTranslation();
  return (
    <Boundary
      fallback={
        <p className="text-caption text-muted-foreground">{t("appcfg.flow.unavailable")}</p>
      }
    >
      <Suspense
        fallback={<p className="text-caption text-muted-foreground">{t("appcfg.flow.loading")}</p>}
      >
        <SlotFlowDiagram rows={rows} who={who} />
      </Suspense>
    </Boundary>
  );
}
export function SlotFlowView({ defId }: { defId: string | undefined }) {
  const f = useSlotFlow(defId);
  if (!defId) return null;
  return <FlowRowsView rows={f.rows} pending={f.pending} error={f.error} />;
}

/** hub-routing-backfill · cùng sơ đồ + bảng bước cho nguồn khác (vd quy trình trong tập gán, đọc qua routing). */
export function FlowRowsView({
  rows,
  pending,
  error,
  view,
  showTitle = true,
  unavailable,
}: {
  rows: StepRow[] | null;
  pending: boolean;
  error: unknown;
  /** CR-121 c11 (Q11): chỉ sơ đồ (canvas) hoặc chỉ bảng bước (list); vắng ⇒ cả hai như cũ. */
  view?: "canvas" | "list";
  /** Tiêu đề "Các bước của quy trình…" — tắt khi nơi dùng đã có tiêu đề (ngăn việc). */
  showTitle?: boolean;
  /** Lý do + bước kế khi không vẽ được (thay câu chung). */
  unavailable?: string;
}) {
  const { t } = useTranslation();
  const who = useWho();
  if (pending)
    return <p className="text-caption text-muted-foreground">{t("appcfg.flow.loading")}</p>;
  if (error || !rows)
    return (
      <p className="text-caption text-muted-foreground">
        {unavailable ?? t("appcfg.flow.unavailable")}
      </p>
    );
  return (
    <div className="space-y-3" data-testid="slot-flow">
      {showTitle ? <h4 className="text-label font-semibold">{t("appcfg.flow.title")}</h4> : null}
      {view === "list" ? null : <Diagram rows={rows} who={who} />}
      {view === "canvas" ? null : (
        <Table>
          <caption className="sr-only">{t("appcfg.flow.title")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("appcfg.flow.col.step")}</TableHead>
              <TableHead>{t("appcfg.flow.col.who")}</TableHead>
              <TableHead>{t("appcfg.flow.col.timing")}</TableHead>
              <TableHead>{t("appcfg.flow.col.condition")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="whitespace-normal font-medium">{`${r.index}. ${r.name}`}</TableCell>
                <TableCell className="whitespace-normal">{who(r.who)}</TableCell>
                <TableCell className="whitespace-normal">
                  {r.timing
                    ? r.timing.remindH
                      ? t("appcfg.flow.timingRemind", {
                          due: r.timing.dueH,
                          remind: r.timing.remindH,
                        })
                      : t("appcfg.flow.timing", { due: r.timing.dueH })
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {r.condition ?? t("appcfg.flow.always")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
