// CR-122 · U2d · FLOW2-FR-26: ô cạnh cạnh vàng trên canvas — "Thiếu <trường>" + "Gợi ý cầu nối"; có đề xuất ⇒ node Ghi giá trị MỜ (xem trước)
// kèm câu giải thích của AI và Nhận / Bỏ; không gợi ý được ⇒ lý do ngay tại ô.
import { HiddenHandle } from "@ai/flow-canvas";
import { type Node, type NodeProps, Position } from "@xyflow/react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useFlowCtx } from "../flow/flow-ctx";

export const BRIDGE_W = 300;
export type BridgeNodeData = {
  from: string;
  to: string;
  keys: string[];
  /** Nhãn nghiệp vụ của từng khoá (vắng ⇒ khoá) + tên bước đích — câu: "Bước «Gửi ký số» cần «Hợp đồng» — bước trước chưa có". */
  labels: string[];
  toName: string;
};
export type BridgeNodeType = Node<BridgeNodeData, "bridge">;

function BridgeNodeImpl({ data }: NodeProps<BridgeNodeType>) {
  const { t } = useTranslation();
  const api = useFlowCtx()?.bridge;
  if (!api) return null;
  const e = { from: data.from, to: data.to };
  const ui = api.ui(e);
  const preview = ui.kind === "ok";
  return (
    <div
      style={{ width: BRIDGE_W }}
      className={`pointer-events-auto relative rounded-md border bg-card p-2 text-left ${
        preview ? "border-dashed border-primary opacity-90" : "border-warning"
      }`}
      data-testid="canvas-bridge"
    >
      {/* chân nối lên cạnh vàng (ô nằm ngay dưới mũi tên) */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-[76px] h-[76px] border-l-2 border-dashed border-warning"
      />
      <HiddenHandle type="target" position={Position.Left} />
      <HiddenHandle type="source" position={Position.Right} />
      <p className="m-0 flex items-center gap-1.5 text-caption font-medium">
        {preview ? (
          <Sparkles aria-hidden className="size-3.5 text-primary" />
        ) : (
          <AlertTriangle aria-hidden className="size-3.5 text-warning" />
        )}
        {preview
          ? t("process.admin.flow.bridge.ghost")
          : t("process.admin.flow.bridge.chipFull", {
              to: data.toName,
              keys: (data.labels.length > 0 ? data.labels : data.keys).join(", "),
            })}
      </p>
      {ui.kind === "idle" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-1.5"
          onClick={() => api.ask(e)}
        >
          {t("process.admin.flow.bridge.suggest")}
        </Button>
      ) : null}
      {ui.kind === "loading" ? (
        <p className="m-0 mt-1 text-caption text-muted-foreground">
          {t("process.admin.flow.bridge.loading")}
        </p>
      ) : null}
      {ui.kind === "fail" || ui.kind === "ok" ? (
        <p className="m-0 mt-1 text-caption text-muted-foreground" data-testid="bridge-text">
          {ui.text}
        </p>
      ) : null}
      {ui.kind === "ok" ? (
        <div className="mt-1.5 flex gap-2">
          <Button type="button" size="sm" onClick={() => api.accept(e)}>
            {t("process.admin.flow.bridge.accept")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => api.dismiss(e)}>
            {t("process.admin.flow.bridge.dismiss")}
          </Button>
        </div>
      ) : null}
      {ui.kind === "fail" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1"
          onClick={() => api.dismiss(e)}
        >
          {t("process.admin.flow.bridge.dismiss")}
        </Button>
      ) : null}
    </div>
  );
}

export const BridgeNode = memo(BridgeNodeImpl);
