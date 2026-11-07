// ADM-FR-71 · fnr-canvas-fit · fnr-editor-drawer: khung nhìn của canvas sơ đồ (ELK) — fit khi tải / "Sắp xếp" / đổi cỡ khung (chừa ngăn chi tiết),
// và pan chọn-node-dưới-ngăn vào vùng thấy. Chuyển nguyên từ admin-web `ProcessCanvas`.
import {
  getNodesBounds,
  getViewportForBounds,
  type ReactFlowInstance,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useEffect, useRef } from "react";
import { NODE_H, NODE_W, revealDx } from "./layout/geometry";

// fnr-canvas-fit: editor vừa khung cả flow (thu tới 0.3 = mức zoom tối thiểu của canvas; dưới nữa thì người dùng kéo/zoom tay), vừa lại khi khung đổi cỡ.
export const FIT = { padding: 0.08, maxZoom: 1, minZoom: 0.3 } as const;
// `compact` (trang showcase, chỉ đọc): canvas thấp + cho thu nhỏ hơn để cả flow vừa khung và nằm giữa.
export const FIT_COMPACT = { padding: 0.02, maxZoom: 1, minZoom: 0.4 } as const;
const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fit vào vùng canvas còn lại bên trái ngăn chi tiết rộng `inset` (px) — tự tính viewport, không dùng padding có đơn vị. */
function fitBesideDrawer(
  rf: ReactFlowInstance,
  size: { w: number; h: number },
  inset: number,
  ms: number,
  minZoom: number,
) {
  const b = getNodesBounds(rf.getNodes());
  const v = getViewportForBounds(
    b,
    Math.max(size.w - inset, 200),
    size.h,
    minZoom,
    FIT.maxZoom,
    FIT.padding,
  );
  return rf.setViewport(v, { duration: ms });
}

/** Fit khi tải / "Sắp xếp" / đổi cỡ khung: cả flow vừa khung (chừa ngăn chi tiết nếu đang mở). */
function runFit(
  rf: ReactFlowInstance,
  size: { w: number; h: number },
  inset: number,
  compact: boolean,
  minZoom: number,
) {
  const ms = reduceMotion() ? 0 : 200;
  if (compact) return rf.fitView({ ...FIT_COMPACT, duration: ms });
  const done =
    inset > 0
      ? fitBesideDrawer(rf, size, inset, ms, minZoom)
      : rf.fitView({ ...FIT, minZoom, duration: ms });
  return done.then(() => {
    const v = rf.getViewport();
    // Quá lớn cho mức zoom đọc được (`minZoom`) ⇒ KHÔNG thu nhỏ thêm: giữ zoom đọc được, neo mép trái/trên, phần còn lại kéo để xem.
    if (v.zoom <= minZoom + 0.001) {
      const b = getNodesBounds(rf.getNodes());
      void rf.setViewport(
        { x: 16 - b.x * minZoom, y: 16 - b.y * minZoom, zoom: minZoom },
        { duration: ms },
      );
    }
  });
}

type Vp = { x: number; y: number; zoom: number };
const sameVp = (a: Vp, b: Vp): boolean =>
  Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 0.01;

/** Node mới thêm nằm ngoài khung nhìn ⇒ pan MƯỢT (giữ zoom) tới khi thấy trọn node, chừa lề 24px và ngăn chi tiết. */
function revealNode(
  rf: ReactFlowInstance,
  id: string,
  size: { w: number; h: number },
  inset: number,
) {
  const n = rf.getNode(id);
  if (!n) return;
  const v = rf.getViewport();
  const w = (n.measured?.width ?? NODE_W) * v.zoom;
  const h = (n.measured?.height ?? NODE_H) * v.zoom;
  const left = n.position.x * v.zoom + v.x;
  const top = n.position.y * v.zoom + v.y;
  const [maxX, maxY] = [size.w - inset - 24, size.h - 24];
  const dx = left < 24 ? 24 - left : left + w > maxX ? maxX - (left + w) : 0;
  const dy = top < 24 ? 24 - top : top + h > maxY ? maxY - (top + h) : 0;
  if (dx !== 0 || dy !== 0)
    void rf.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: reduceMotion() ? 0 : 300 });
}
export type ViewFitOptions = {
  /** Đổi giá trị ⇒ fit lại (số bước + số giai đoạn do host ghép). */
  sig: string;
  /** Đổi giá trị ⇒ canvas fit lại khung nhìn (sau "Sắp xếp"). */
  fitKey: number;
  /** Bề rộng (px) ngăn chi tiết đang đè lên mép phải canvas (0 = không). */
  inset: number;
  compact: boolean;
  fitMin: number;
  selected: string | undefined;
  /** Nút "vừa khung" của Controls gọi hàm này (cùng luật fit: đọc được, không thu nhỏ tí hon). */
  fitRef?: { current: (() => void) | null };
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
    void runFit(rf, size, inset.current, opts.current.compact, opts.current.fitMin).then(() => {
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
      const added = [...ids].filter((i) => !p.ids.has(i));
      prev.current = { ...p, fitted: true, fitKey: opts.current.fitKey, box, ids };
      if (wantFit) return doFit();
      const first = added.find((i) => i !== "trigger" && !i.startsWith("bridge:"));
      if (first)
        revealNode(rf, first, { w: widthRef.current, h: heightRef.current }, inset.current);
    }, 60);
    return () => window.clearTimeout(id);
  }, [stepsKey]);
  // chọn node nằm dưới ngăn chi tiết ⇒ pan vào vùng thấy được (không đổi zoom, không fit lại khi mở/đóng ngăn)
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khi đổi node chọn / bật tắt ngăn
  useEffect(() => {
    const sel = o.selected;
    if (!sel || inset.current <= 0) return;
    const id = window.setTimeout(() => {
      const n = rf.getNode(sel);
      if (!n) return;
      const v = rf.getViewport();
      const left = n.position.x * v.zoom + v.x;
      const right = left + (n.measured?.width ?? NODE_W) * v.zoom;
      const dx = revealDx(left, right, widthRef.current, inset.current);
      if (dx !== 0)
        void rf.setViewport({ ...v, x: v.x + dx }, { duration: reduceMotion() ? 0 : 200 });
    }, 260);
    return () => window.clearTimeout(id);
  }, [o.selected, o.inset > 0]);
}
