// ADM-FR-71 · fnr-canvas-fit · fnr-editor-drawer: khung nhìn của canvas `columns` — fit khi tải / "Sắp xếp" / đổi cỡ khung (chừa ngăn chi tiết),
// và pan chọn-node-dưới-ngăn vào vùng thấy. Chuyển nguyên từ admin-web `ProcessCanvas`.
import {
  getNodesBounds,
  getViewportForBounds,
  type ReactFlowInstance,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useEffect, useRef } from "react";
import { NODE_W, revealDx } from "./layout/columns";

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
    // quá rộng cho cả mức zoom nhỏ nhất ⇒ neo mép trái (bước đầu luôn thấy), phần còn lại kéo ngang
    const v = rf.getViewport();
    // (neo theo mép trái của node ngoài cùng — có thể < 0 khi canvas có cột đầu như node "Bắt đầu khi")
    if (v.zoom <= minZoom + 0.001) {
      // và neo mép TRÊN (lề đều 16px) thay vì để trống dọc.
      const b = getNodesBounds(rf.getNodes());
      void rf.setViewport({ ...v, x: 16 - b.x * v.zoom, y: 16 - b.y * v.zoom });
    }
  });
}

export type ColumnsFitOptions = {
  /** Đổi giá trị ⇒ fit lại (số bước + số giai đoạn do host ghép). */
  sig: string;
  /** Đổi giá trị ⇒ canvas fit lại khung nhìn (sau "Sắp xếp"). */
  fitKey: number;
  /** Bề rộng (px) ngăn chi tiết đang đè lên mép phải canvas (0 = không). */
  inset: number;
  compact: boolean;
  fitMin: number;
  selected: string | undefined;
};

export function useColumnsFit(o: ColumnsFitOptions): void {
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
  // chỉ khi số bước / số giai đoạn / "Sắp xếp" / cỡ khung đổi (`rf` ổn định)
  // biome-ignore lint/correctness/useExhaustiveDependencies: stepsKey chủ ý
  useEffect(() => {
    const size = { w: width, h: height };
    const id = window.setTimeout(
      () => void runFit(rf, size, inset.current, opts.current.compact, opts.current.fitMin),
      60,
    );
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
