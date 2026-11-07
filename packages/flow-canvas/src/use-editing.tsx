// CR-123 · p25 · @ai/flow-canvas · móc sửa tay (opt-in qua `FlowCanvasProps.editing`): chọn nhiều, phím tắt, thả từ bảng mẫu, nối lại cạnh.
// Vắng `editing` ⇒ mọi thứ trả nguyên (nodes/edges không bị sao chép, không có vỏ bọc) nên canvas của workspace-web không đổi.
import {
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowProps,
  useReactFlow,
} from "@xyflow/react";
import {
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { commandOfKey, FLOW_PALETTE_MIME, type FlowEditing, type FlowSelection } from "./editing";

type OnReconnectEnd = NonNullable<ReactFlowProps["onReconnectEnd"]>;
type Sel = { nodes: ReadonlySet<string>; edges: ReadonlySet<string> };
type SelChange = { type: string; id?: string; selected?: boolean };
const NONE: Sel = { nodes: new Set(), edges: new Set() };
const NOOP = (): void => undefined;
const IGNORE_KEYS = "input,textarea,select,[contenteditable='true'],[role='menu'],[role='dialog']";

const CSS = `
.react-flow__node.selected > * { outline: 2px solid var(--color-primary); outline-offset: 3px; border-radius: 10px; }
.react-flow__edge.selected .react-flow__edge-path { stroke: var(--color-primary) !important; stroke-width: 3px !important; }
.react-flow__edge.flow-drop-target .react-flow__edge-path { stroke: var(--color-primary) !important; stroke-width: 4px !important; stroke-dasharray: 6 4; }`;

function applySelect(cur: ReadonlySet<string>, cs: readonly SelChange[]): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const c of cs) {
    if (c.type !== "select" || !c.id) continue;
    next ??= new Set(cur);
    if (c.selected) next.add(c.id);
    else next.delete(c.id);
  }
  return next ?? cur;
}

/** Cạnh dưới điểm (x, y) của màn hình — dò mọi phần tử xếp chồng (kể cả dưới nút "+" của cạnh). */
export function edgeAtPoint(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest(".react-flow__edge")?.getAttribute("data-id");
    if (id) return id;
  }
  return null;
}

/** Node dưới điểm (x, y) — dùng khi thả dây nối không trúng handle (handle đích của node ẩn). */
export function nodeAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  return el?.closest(".react-flow__node")?.getAttribute("data-id") ?? null;
}

function useSelection(enabled: boolean) {
  const [sel, setSel] = useState<Sel>(NONE);
  const ref = useRef(sel);
  ref.current = sel;
  const onNodes = useCallback(
    (cs: NodeChange[]) => {
      if (enabled)
        setSel((s) => {
          const nodes = applySelect(s.nodes, cs as SelChange[]);
          return nodes === s.nodes ? s : { ...s, nodes };
        });
    },
    [enabled],
  );
  const onEdges = useCallback(
    (cs: SelChange[]) => {
      if (enabled)
        setSel((s) => {
          const edges = applySelect(s.edges, cs);
          return edges === s.edges ? s : { ...s, edges };
        });
    },
    [enabled],
  );
  return { sel, ref, onNodes, onEdges };
}

function usePaletteDrop(on: FlowEditing["onPaletteDrop"], focus: () => void) {
  const rf = useReactFlow();
  const [over, setOver] = useState<string | null>(null);
  const accepts = (e: DragEvent) => !!on && e.dataTransfer.types.includes(FLOW_PALETTE_MIME);
  const onDragOver = (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const id = edgeAtPoint(e.clientX, e.clientY);
    setOver((prev) => (prev === id ? prev : id));
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setOver(null);
  };
  const onDrop = (e: DragEvent) => {
    const data = e.dataTransfer.getData(FLOW_PALETTE_MIME);
    if (!on || !data) return;
    e.preventDefault();
    setOver(null);
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    on({ data, position, edgeId: edgeAtPoint(e.clientX, e.clientY) });
    focus();
  };
  return { over, onDragOver, onDragLeave, onDrop };
}

export type EditingView = {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (cs: NodeChange[]) => void;
  flowProps: Partial<ReactFlowProps>;
  /** Thuộc tính vỏ bọc nhận phím + thả (vẽ bằng `EditShell`); `null` khi không bật `editing`. */
  shell: ShellProps | null;
  miniMap: boolean;
};

type ShellProps = HTMLAttributes<HTMLDivElement> & { ref: RefObject<HTMLDivElement | null> };

/** Vỏ bọc canvas khi bật `editing`: giữ focus bàn phím, nhận thả từ bảng mẫu, kèm kiểu chọn/đích thả. */
export function EditShell({ shell, children }: { shell: ShellProps | null; children: ReactNode }) {
  if (!shell) return <>{children}</>;
  return (
    <div {...shell} data-testid="flow-canvas-shell">
      <style>{CSS}</style>
      {children}
    </div>
  );
}

export function useEditing(ed: FlowEditing | undefined, nodes: Node[], edges: Edge[]): EditingView {
  const s = useSelection(!!ed?.selectable);
  const box = useRef<HTMLDivElement>(null);
  const drop = usePaletteDrop(ed?.onPaletteDrop, () => box.current?.focus({ preventScroll: true }));
  const nodesOut = useMemo(
    () =>
      s.sel.nodes.size
        ? nodes.map((n) => (s.sel.nodes.has(n.id) ? { ...n, selected: true } : n))
        : nodes,
    [nodes, s.sel.nodes],
  );
  const edgesOut = useMemo(() => {
    if (!s.sel.edges.size && drop.over === null) return edges;
    return edges.map((e) => {
      const hot =
        e.id === drop.over ? { className: `${e.className ?? ""} flow-drop-target` } : null;
      return s.sel.edges.has(e.id) ? { ...e, selected: true, ...hot } : hot ? { ...e, ...hot } : e;
    });
  }, [edges, s.sel.edges, drop.over]);
  const cmd = ed?.onCommand;
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (!cmd || (e.target as HTMLElement).closest(IGNORE_KEYS)) return;
    const c = commandOfKey(e.nativeEvent);
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    const ids = new Set(nodes.map((n) => n.id));
    const edgeIds = new Set(edges.map((x) => x.id));
    const out: FlowSelection = {
      nodes: [...s.ref.current.nodes].filter((id) => ids.has(id)),
      edges: [...s.ref.current.edges].filter((id) => edgeIds.has(id)),
    };
    cmd(c, out);
  };
  const reconnectEnd: OnReconnectEnd = (ev, edge, _t, st) => {
    const pt = "changedTouches" in ev ? ev.changedTouches[0] : ev;
    const to = st.toNode?.id ?? (pt ? nodeAtPoint(pt.clientX, pt.clientY) : null);
    if (to)
      ed?.onReconnect?.(edge.id, {
        source: edge.source,
        target: to,
        sourceHandle: edge.sourceHandle ?? null,
      });
  };
  const shell: ShellProps = {
    ref: box,
    tabIndex: -1,
    className: "size-full outline-none",
    onKeyDownCapture,
    onDragOver: drop.onDragOver,
    onDragLeave: drop.onDragLeave,
    onDrop: drop.onDrop,
  };
  return {
    nodes: nodesOut,
    edges: edgesOut,
    onNodesChange: s.onNodes,
    miniMap: !!ed?.miniMap,
    shell: ed ? shell : null,
    flowProps: ed ? flowPropsOf(ed, s.onEdges, reconnectEnd) : {},
  };
}

function flowPropsOf(
  ed: FlowEditing,
  onEdgesChange: (cs: SelChange[]) => void,
  onReconnectEnd: OnReconnectEnd,
): Partial<ReactFlowProps> {
  return {
    ...(ed.selectable
      ? {
          elementsSelectable: true,
          multiSelectionKeyCode: ["Shift", "Control", "Meta"],
          onEdgesChange: onEdgesChange as ReactFlowProps["onEdgesChange"],
        }
      : {}),
    ...(ed.isValidConnection
      ? {
          isValidConnection: (c: Edge | Connection) =>
            ed.isValidConnection?.(c as Connection) ?? true,
        }
      : {}),
    ...(ed.onReconnect ? { edgesReconnectable: false, onReconnect: NOOP, onReconnectEnd } : {}),
    zoomActivationKeyCode: ["Control", "Meta"],
  };
}
