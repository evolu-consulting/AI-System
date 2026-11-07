// ADM-FR-71 · fnr-canvas-fit · fnr-editor-drawer: khung nhìn của canvas sơ đồ (ELK) — fit khi tải / "Sắp xếp" / đổi cỡ khung (chừa ngăn chi tiết),
// và pan chọn-node-dưới-ngăn vào vùng thấy. Chuyển nguyên từ admin-web `ProcessCanvas`.
import { getNodesBounds, type ReactFlowInstance, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { fitViewport } from "./fit";
import { NODE_H, NODE_W } from "./layout/geometry";
import { fitGroup, focusViewport } from "./view-focus";

// CR-125 · x11 · MỘT luật vừa khung (`fit.ts`): cả flow nằm trọn trong khung, chỉ dừng ở mức zoom tối thiểu của canvas (0.15), không còn sàn "đọc được" cắt đuôi flow.
export const FIT = { padding: 0.08, maxZoom: 1, minZoom: 0.15 } as const;
// `compact` (trang showcase, chỉ đọc): canvas thấp, ít chừa mép để cả flow vừa khung và nằm giữa.
export const FIT_COMPACT = { padding: 0.02, maxZoom: 1, minZoom: 0.15 } as const;
const PORT_PAD = 40;
const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fit khi tải / "Sắp xếp" / nút "vừa khung" / đổi cỡ khung: cả flow vừa vùng thấy được (chừa ngăn chi tiết nếu đang mở). */
function runFit(
  rf: ReactFlowInstance,
  size: { w: number; h: number },
  inset: number,
  compact: boolean,
) {
  const f = compact ? FIT_COMPACT : FIT;
  const b = getNodesBounds(rf.getNodes());
  const v = fitViewport(
    { x: b.x, y: b.y, w: b.width, h: b.height },
    { size, inset, padding: f.padding, maxZoom: f.maxZoom, minZoom: f.minZoom },
  );
  return rf.setViewport(v, { duration: reduceMotion() ? 0 : 200 });
}
type Vp = { x: number; y: number; zoom: number };
const sameVp = (a: Vp, b: Vp): boolean =>
  Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 0.01;

/** Mức zoom thấp nhất khi thu nhỏ để thấy node chọn + node kề bên trái ngăn chi tiết (thấp hơn mức fit đọc được; chữ node vẫn nhận ra). */
const REVEAL_MIN = 0.55;

/** CR-125 · x4 · khung nhìn đích để node chọn + node kề (vào/ra) nằm TRỌN trong vùng thấy được bên trái ngăn chi tiết (pan, thu nhỏ khi cần, không phóng to). */
function revealSelection(
  rf: ReactFlowInstance,
  sel: string,
  size: { w: number; h: number },
  inset: number,
  minZoom: number,
): Vp | null {
  const me = rf.getNode(sel);
  if (!me) return null;
  const near = new Set<string>();
  for (const e of rf.getEdges()) {
    if (e.source === sel) near.add(e.target);
    if (e.target === sel) near.add(e.source);
  }
  // +PORT_PAD: nhãn đầu ra / chấm nối nhô ra khỏi mép phải node
  const boxOf = (m: NonNullable<ReturnType<typeof rf.getNode>>) => ({
    x: m.position.x,
    y: m.position.y,
    w: (m.measured?.width ?? NODE_W) + PORT_PAD,
    h: m.measured?.height ?? NODE_H,
  });
  const main = boxOf(me);
  const dist = (b: { x: number; y: number }) => Math.hypot(b.x - main.x, b.y - main.y);
  const others = [...near]
    .filter((i) => !i.startsWith("bridge:"))
    .flatMap((i) => {
      const m = rf.getNode(i);
      return m ? [boxOf(m)] : [];
    })
    .sort((a, b) => dist(a) - dist(b));
  // không phóng to khi hiện node chọn: sàn không cao hơn zoom hiện tại (flow đã fit nhỏ để vừa khung)
  const floor = Math.min(minZoom, REVEAL_MIN, rf.getViewport().zoom);
  return focusViewport(
    fitGroup([main, ...others], size, inset, floor),
    rf.getViewport(),
    size,
    inset,
    floor,
  );
}

export type ViewFitOptions = {
  /** Đổi giá trị ⇒ fit lại (số bước + số giai đoạn do host ghép). */
  sig: string;
  /** Đổi giá trị ⇒ canvas fit lại khung nhìn (sau "Sắp xếp"). */
  fitKey: number;
  /** Bề rộng (px) ngăn chi tiết đang đè lên mép phải canvas (0 = không). */
  inset: number;
  compact: boolean;
  /** Sàn zoom khi THEO node (thả / nối / chọn): không dùng cho "vừa khung" — fit luôn đưa CẢ flow vào khung. */
  fitMin: number;
  selected: string | undefined;
  /** Nút "vừa khung" của Controls gọi hàm này (cùng luật fit: đọc được, không thu nhỏ tí hon). */
  fitRef?: { current: (() => void) | null };
  /** CR-123 · u14 · node đang làm việc (node mới thả + node vừa nối; node mới ĐẦU): sau thả / nối / bố cục lại phải nằm trọn trong khung. */
  focus?: readonly string[];
};

export function useViewFit(o: ViewFitOptions): void {
  const rf = useReactFlow();
  // khung đổi cỡ (mở/đóng panel giai đoạn, resize cửa sổ) ⇒ fit lại; còn lại giữ pan/zoom của người dùng
  const box = useStore((s) => `${Math.round(s.width / 8)}x${Math.round(s.height / 8)}`);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const widthRef = useRef(0);
  widthRef.current = width;
  const inset = useRef(0);
  inset.current = o.inset;
  const opts = useRef(o);
  opts.current = o;
  const stepsKey = `${o.sig}:${o.fitKey}:${box}`;
  const heightRef = useRef(0);
  heightRef.current = height;
  const prev = useRef({
    fitKey: o.fitKey,
    box: "",
    ids: new Set<string>(),
    vp: null as Vp | null,
    fitted: false,
  });
  const doFit = () => {
    const size = { w: widthRef.current, h: heightRef.current };
    void runFit(rf, size, inset.current, opts.current.compact).then(() => {
      prev.current.vp = rf.getViewport();
    });
  };
  if (o.fitRef) o.fitRef.current = doFit;
  // CR-123 · u11: fit CHỈ khi mở lần đầu / bấm "vừa khung" / "Sắp xếp" / khung đổi cỡ mà người dùng chưa kéo-zoom; thêm node KHÔNG fit lại
  // (giữ zoom + pan của người dùng, chỉ pan mượt tới node mới nếu nó nằm ngoài khung nhìn).
  // biome-ignore lint/correctness/useExhaustiveDependencies: stepsKey chủ ý
  useEffect(() => {
    const id = window.setTimeout(() => {
      const nodes = rf.getNodes();
      if (nodes.length === 0) return;
      const p = prev.current;
      const ids = new Set(nodes.map((n) => n.id));
      const untouched = p.vp !== null && sameVp(rf.getViewport(), p.vp);
      const wantFit = !p.fitted || p.fitKey !== opts.current.fitKey || (p.box !== box && untouched);
      prev.current = { ...p, fitted: true, fitKey: opts.current.fitKey, box, ids };
      if (wantFit) doFit();
    }, 60);
    return () => window.clearTimeout(id);
  }, [stepsKey]);
  // CR-123 · u14 · sau thả / nối / ELK bố cục lại: node đang làm việc + node vừa nối ở TRỌN trong khung (pan/thu nhỏ mượt, zoom ≥ fitMin, không phóng to);
  // chạy lại khi vị trí các node đó đổi (ELK xếp lại sau khi sửa) nhưng KHÔNG khi người dùng tự kéo/zoom khung nhìn.
  const focusIds = o.focus ?? [];
  const focusSig = useStore((s) =>
    focusIds
      .map((id) => {
        const n = s.nodeLookup.get(id);
        return n
          ? `${id}@${Math.round(n.internals.positionAbsolute.x)},${Math.round(n.internals.positionAbsolute.y)}`
          : id;
      })
      .join("|"),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khi vị trí node đang làm việc đổi
  useEffect(() => {
    if (focusIds.length === 0) return;
    const id = window.setTimeout(() => {
      const boxes = focusIds.flatMap((i) => {
        const n = rf.getNode(i);
        return n
          ? [
              {
                x: n.position.x,
                y: n.position.y,
                w: n.measured?.width ?? NODE_W,
                h: n.measured?.height ?? NODE_H,
              },
            ]
          : [];
      });
      const to = focusViewport(
        boxes,
        rf.getViewport(),
        { w: widthRef.current, h: heightRef.current },
        inset.current,
        Math.min(opts.current.fitMin, rf.getViewport().zoom), // không phóng to khi theo node mới
      );
      if (to)
        void rf.setViewport(to, { duration: reduceMotion() ? 0 : 300 }).then(() => {
          prev.current.vp = rf.getViewport();
        });
    }, 140);
    return () => window.clearTimeout(id);
  }, [focusSig]);
  // chọn node nằm dưới ngăn chi tiết ⇒ pan vào vùng thấy được (không đổi zoom, không fit lại khi mở/đóng ngăn)
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khi đổi node chọn / bật tắt ngăn
  useEffect(() => {
    const sel = o.selected;
    if (!sel || inset.current <= 0) return;
    const id = window.setTimeout(() => {
      const to = revealSelection(
        rf,
        sel,
        { w: widthRef.current, h: heightRef.current },
        inset.current,
        opts.current.fitMin,
      );
      if (to) void rf.setViewport(to, { duration: reduceMotion() ? 0 : 200 });
    }, 260);
    return () => window.clearTimeout(id);
  }, [o.selected, o.inset > 0]);
}
