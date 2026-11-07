// CR-123 · p25 · FLOW3-FR-04..08 · nối canvas (`@ai/flow-canvas` `editing`) với bản nháp: thả từ bảng mẫu, nối lại cạnh, xoá, chép/dán, hoàn tác.
// Luật hợp lệ KHÔNG viết lại ở đây: `connectPatch` (canvas-connect) cho nối / nối lại, `ops.*` (lib/canvas-edit, step-ops) cho phần còn lại.
import type { FlowCommand, FlowEditing, FlowSelection, PaletteDrop } from "@ai/flow-canvas/pure";
import { NODE_H, NODE_W } from "@ai/flow-canvas/pure";
import type { Edge, Node } from "@xyflow/react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { PickedItem } from "../../hooks/use-canvas-edit";
import type { StageOps } from "../../hooks/use-stage-ops";
import { hasConfig } from "../../lib/canvas-edit";
import type { StageView } from "./stage-view";

type EdgeSel = { source: string; side?: "yes" | "no" | undefined };
type Pending = { uids: string[]; edges: EdgeSel[] };
type Latest = {
  views: readonly StageView[];
  nodes: readonly Node[];
  edges: readonly Edge[];
  ops: StageOps;
};

const sideOf = (e: Edge): "yes" | "no" | undefined => {
  const s = (e.data as { side?: string } | undefined)?.side;
  return s === "yes" || s === "no" ? s : undefined;
};

function parseItems(data: string): PickedItem[] {
  try {
    const v: unknown = JSON.parse(data);
    return Array.isArray(v) ? (v as PickedItem[]) : [];
  } catch {
    return [];
  }
}

function dropPalette(l: Latest, d: PaletteDrop): void {
  const items = parseItems(d.data);
  if (items.length === 0) return;
  // CR-123 · u5 · thả = node ĐỨNG RIÊNG tại điểm thả (không tự nối, không tự chèn lên cạnh); nối bằng mũi tên, chèn bằng nút "+" trên cạnh
  l.ops.dropNodes(items, { x: d.position.x - NODE_W / 2, y: d.position.y - NODE_H / 2 });
}

const sideOpt = (e: Edge): { side?: "yes" | "no" } => {
  const side = sideOf(e);
  return side ? { side } : {};
};

function selectionOf(l: Latest, sel: FlowSelection): Pending {
  const ids = new Set(l.views.map((v) => v.uid));
  const edges = sel.edges.flatMap((id) => {
    const e = l.edges.find((x) => x.id === id);
    return e ? [{ source: e.source, side: sideOf(e) }] : [];
  });
  return { uids: sel.nodes.filter((id) => ids.has(id)), edges };
}

function command(l: Latest, cmd: FlowCommand, sel: FlowSelection, ask: (p: Pending) => void) {
  const { ops } = l;
  if (cmd === "undo") return ops.undo();
  if (cmd === "redo") return ops.redo();
  if (cmd === "copy") return ops.copy(sel.nodes);
  if (cmd === "paste") return ops.paste(sel.nodes);
  const p = selectionOf(l, sel);
  if (p.uids.length === 0 && p.edges.length === 0) return ops.fail({ error: "empty" });
  const withConfig = l.views.some((v) => p.uids.includes(v.uid) && hasConfig(v.src));
  if (withConfig) ask(p);
  else ops.removeSelection(p.uids, p.edges);
}

type Args = {
  enabled: boolean;
  palette: boolean;
  compact: boolean;
  latest: Latest;
};

/** `editing` cho `FlowCanvas` + hộp xác nhận xoá (chỉ khi xoá bước đã có cấu hình). */
export function useCanvasEditing(a: Args) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef(a.latest);
  ref.current = a.latest;
  const editing = useMemo<FlowEditing | undefined>(
    () =>
      a.enabled
        ? {
            selectable: true,
            miniMap: !a.compact,
            isValidConnection: (c) => {
              // vi phạm luật vẫn cho thả để `connect` báo LÝ DO bằng toast (không từ chối im lặng)
              void c;
              return true;
            },
            onReconnect: (edgeId, to) => {
              const e = ref.current.edges.find((x) => x.id === edgeId);
              if (e)
                ref.current.ops.reconnect(
                  {
                    source: e.source,
                    target: e.target,
                    ...sideOpt(e),
                    handle: e.sourceHandle ?? null,
                  },
                  to.target,
                );
            },
            onCommand: (cmd, sel) => command(ref.current, cmd, sel, setPending),
            ...(a.palette
              ? { onPaletteDrop: (d: PaletteDrop) => dropPalette(ref.current, d) }
              : {}),
          }
        : undefined,
    [a.enabled, a.palette, a.compact],
  );
  return { editing, pending, close: () => setPending(null) };
}

export function CanvasDialogs(p: {
  pending: Pending | null;
  close: () => void;
  views: readonly StageView[];
  ops: StageOps;
}) {
  const { t } = useTranslation();
  const { pending } = p;
  const first = p.views.find((v) => v.uid === pending?.uids[0]);
  const count = pending?.uids.length ?? 0;
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && p.close()}
      title={
        count === 1
          ? t("process.admin.canvas.confirmRemove.title", { name: first?.name ?? "" })
          : t("process.admin.canvas.edit.confirmMany", { n: count })
      }
      description={t("process.admin.canvas.edit.confirmBody")}
      confirmLabel={t("process.admin.editor.remove")}
      destructive
      onConfirm={() => {
        if (pending) p.ops.removeSelection(pending.uids, pending.edges);
      }}
    />
  );
}
