// CR-127 · UI-FLOW · mock Editor.dc: màn soạn quy trình VẼ THEO KHỐI bằng @xyflow/react (qua `@ai/flow-canvas`, cùng khung với canvas CR-121–123).
// Bố cục tự động từ trên xuống (`outline-layout.ts`, không lưu toạ độ, không kéo thả tự do); kéo nền để pan, Ctrl + cuộn / nút để zoom.
// Nút "+" là node nằm TRÊN đường nối; bấm khối = chọn + mở panel phải; lên / xuống / xoá hiện khi rê chuột lên khối.
// Chunk nạp lười (`OutlineView` dùng `React.lazy`): kéo theo xyflow nên không nằm trong gói chính.
import { FlowCanvas, HiddenHandle } from "@ai/flow-canvas";
import { type Edge, type Node, type NodeProps, Position } from "@xyflow/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Loc } from "../../lib/outline-edit";
import type { PickedNode } from "../flow/NodeMenuContent";
import { AddGap, DoneRow, StartRow, StepRow, type StepRowProps } from "./OutlineRows";
import { gapTestId, type LEdge, type LItem, type LNode, layoutOutline } from "./outline-layout";

export type OutlineCanvasProps = {
  items: readonly LItem[];
  /** Thẻ của từng bước theo mã bước (khối Nếu cũng là một thẻ). */
  cards: ReadonlyMap<string, StepRowProps>;
  start: boolean;
  readOnly: boolean;
  /** Còn chỗ cho bao nhiêu bước nữa (0 ⇒ "+" tắt). */
  room: number;
  /** Mã bước đang mở ở panel phải. */
  selectedKey: string | undefined;
  onInsert: (loc: Loc, index: number, items: PickedNode[]) => void;
};

type Data = {
  w: number;
  h: number;
  card?: StepRowProps | undefined;
  loc?: Loc | undefined;
  index?: number | undefined;
  side?: "yes" | "no" | undefined;
  readOnly?: boolean;
  room?: number;
  onInsert?: OutlineCanvasProps["onInsert"];
};
type OutNode = Node<Data>;

/** Khung node: kích thước cố định theo bố cục, cổng vô hình trên / dưới (đường nối đi qua giữa node). */
function Shell({ data, children }: { data: Data; children?: React.ReactNode }) {
  return (
    <div style={{ width: data.w, height: data.h }} className="pointer-events-auto">
      <HiddenHandle type="target" position={Position.Top} />
      <HiddenHandle type="source" position={Position.Bottom} />
      {children}
    </div>
  );
}

type LooseT = (key: string) => string;
/** Khoá `process.admin.*` nạp lười (không nằm trong kiểu khoá của `vi.json`) ⇒ `t` nhận chuỗi tự do. */
const useLooseT = () => useTranslation() as unknown as { t: LooseT };

const StepNode = ({ data }: NodeProps<OutNode>) => (
  <Shell data={data}>{data.card ? <StepRow {...data.card} /> : null}</Shell>
);
const StartNode = ({ data }: NodeProps<OutNode>) => (
  <Shell data={data}>
    <StartRow />
  </Shell>
);
const DoneNode = ({ data }: NodeProps<OutNode>) => (
  <Shell data={data}>
    <DoneRow />
  </Shell>
);
const GapNode = ({ data }: NodeProps<OutNode>) => (
  <Shell data={data}>
    {data.readOnly || !data.onInsert ? null : (
      <AddGap
        room={data.room ?? 0}
        testId={gapTestId(data.loc ?? null, data.index ?? 0)}
        onPick={(items) => data.onInsert?.(data.loc ?? null, data.index ?? 0, items)}
      />
    )}
  </Shell>
);
function LabelNode({ data }: NodeProps<OutNode>) {
  const { t } = useLooseT();
  const yes = data.side === "yes";
  return (
    <Shell data={data}>
      <span
        className={cn(
          "flex h-full items-center justify-center rounded-full text-caption font-bold uppercase tracking-wide",
          yes ? "text-success" : "text-muted-foreground",
        )}
      >
        {t(`process.admin.flow.outline.${yes ? "yes" : "no"}`)}
      </span>
    </Shell>
  );
}
function EmptyNode({ data }: NodeProps<OutNode>) {
  const { t } = useLooseT();
  return (
    <Shell data={data}>
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border px-3 text-center text-caption text-muted-foreground">
        {t("process.admin.flow.outline.emptyBranch")}
      </div>
    </Shell>
  );
}
const DotNode = ({ data }: NodeProps<OutNode>) => <Shell data={data} />;

const NODE_TYPES = {
  step: StepNode,
  if: StepNode,
  start: StartNode,
  end: DoneNode,
  gap: GapNode,
  label: LabelNode,
  empty: EmptyNode,
  dot: DotNode,
};

const EDGE_STYLE = { stroke: "var(--color-muted-foreground)", strokeOpacity: 0.5, strokeWidth: 2 };

const edgeOf = (e: LEdge): Edge =>
  ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.kind === "line" ? "straight" : "smoothstep",
    ...(e.kind === "line" ? {} : { pathOptions: { borderRadius: 12 } }),
    focusable: false,
    selectable: false,
    style: EDGE_STYLE,
  }) as Edge;

const nodeOf = (n: LNode, p: OutlineCanvasProps): OutNode => ({
  id: n.id,
  type: n.type,
  position: { x: n.x, y: n.y },
  measured: { width: n.w, height: n.h },
  draggable: false,
  selectable: false,
  focusable: false,
  connectable: false,
  data: {
    w: n.w,
    h: n.h,
    card: p.cards.get(n.id),
    loc: n.loc,
    index: n.index,
    side: n.side,
    readOnly: p.readOnly,
    room: p.room,
    onInsert: p.onInsert,
  },
});

export default function OutlineCanvas(p: OutlineCanvasProps) {
  const { t } = useTranslation();
  const layout = useMemo(() => layoutOutline(p.items, p.start), [p.items, p.start]);
  const nodes = useMemo(() => layout.nodes.map((n) => nodeOf(n, p)), [layout, p]);
  const edges = useMemo(() => layout.edges.map(edgeOf), [layout]);
  // Cao theo sơ đồ (khung nhìn vừa khít ≈ 0,9×): chữ đọc được, sơ đồ dài thì cuộn trang (cuộn chuột không zoom); kéo nền = pan, Ctrl + cuộn / nút = zoom.
  const height = Math.round(Math.min(1600, Math.max(520, layout.bounds.h * 0.9 + 80)));
  return (
    <div
      data-testid="outline-canvas"
      style={{ height }}
      className="relative overflow-hidden rounded-md border border-border bg-muted/30"
    >
      <FlowCanvas
        layout="flow"
        mode="view"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES as never}
        labels={{
          canvas: t("process.admin.canvas.title"),
          controls: {
            title: t("process.admin.canvas.controls.title"),
            zoomIn: t("process.admin.canvas.controls.zoomIn"),
            zoomOut: t("process.admin.canvas.controls.zoomOut"),
            fit: t("process.admin.canvas.controls.fit"),
            minimap: t("process.admin.canvas.controls.minimap"),
          },
        }}
        fitSig={String(nodes.length)}
        selectedId={p.selectedKey}
      />
    </div>
  );
}
