// ADM-FR-71 · P-b2 (plan-frontend FB2/FB3, §1 "Trạng thái"): nạp canvas bằng `React.lazy` (chunk tên `canvas`).
// Đang tải ⇒ StepList (không nhấp nháy rỗng); nạp lỗi ⇒ StepList + Alert + "Thử lại".
import { Component, lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ProcessCanvasProps } from "./ProcessCanvas";
import { StepList } from "./StepList";

type Props = ProcessCanvasProps;

/** Tạo lại `lazy` mỗi lần thử (promise lỗi của `lazy` bị cache). */
const loadCanvas = () => import(/* webpackChunkName: "canvas" */ "./ProcessCanvas");

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

function listOf(p: Props) {
  return (
    <StepList
      views={p.views}
      selected={p.selected}
      readOnly={p.readOnly}
      ops={p.ops}
      onSelect={p.onSelect}
      onRemove={p.onRemove}
    />
  );
}

export function CanvasView(p: Props) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt chủ ý tạo lại lazy
  const Canvas = useMemo(() => lazy(loadCanvas), [attempt]);
  return (
    <Boundary
      key={attempt}
      fallback={() => (
        <div className="space-y-3">
          <Alert>
            <AlertDescription className="flex items-center gap-3">
              <span className="flex-1">{t("process.admin.canvas.loadFailed")}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("process.admin.canvas.retry")}
              </Button>
            </AlertDescription>
          </Alert>
          {listOf(p)}
        </div>
      )}
    >
      <Suspense
        fallback={
          // Ẩn khỏi cây trợ năng + không nhận chuột trong lúc chờ chunk (tránh thao tác lên nút sắp bị thay).
          <>
            <p role="status" className="sr-only">
              {t("process.admin.canvas.loading")}
            </p>
            <div aria-hidden="true" className="pointer-events-none opacity-60">
              {listOf(p)}
            </div>
          </>
        }
      >
        <Canvas {...p} />
      </Suspense>
    </Boundary>
  );
}
