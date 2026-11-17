// CR-181 · sân khấu «Từng trang»: pdf.js vẽ các trang theo chiều dọc (canvas theo devicePixelRatio ≤ 2); huỷ khi đổi tệp.

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { StagePage } from "../lib/geometry";
import { layoutPages, type PageSize } from "../lib/layout";
import { isInsideStage } from "../lib/stage-target";

export type StageLayout = { pages: StagePage[]; width: number; height: number };
const DPR_MAX = 2;
const LONG_PRESS_MS = 550;
const MOVE_CANCEL_PX = 8;

function PageCanvas({ doc, page }: { doc: PDFDocumentProxy; page: StagePage }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { cancel: () => void } | undefined;
    let dead = false;
    void doc.getPage(page.index + 1).then((pg) => {
      const c = ref.current;
      if (dead || !c) return;
      const vp = pg.getViewport({ scale: page.width / page.ptWidth });
      const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      const r = pg.render({
        canvas: c,
        viewport: vp,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      task = r;
      r.promise.catch(() => undefined);
    });
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, page.index, page.width, page.ptWidth]);
  return (
    <div
      role="img"
      aria-label={t("contracts.docsign.pageLabel", { n: page.index + 1 })}
      data-testid="sign-page"
      className="absolute bg-white shadow"
      style={{ left: page.left, top: page.top, width: page.width, height: page.height }}
    >
      <canvas ref={ref} className="size-full" />
    </div>
  );
}

export function PageStage(p: {
  doc: PDFDocumentProxy;
  sizes: PageSize[];
  scrollTo: { index: number; nonce: number } | null;
  onCurrentPage: (i: number) => void;
  onDropTray: (trayId: string, x: number, y: number) => void;
  /** Chuột phải hoặc chạm giữ 550ms trên chỗ trống; toạ độ trên sân khấu. */
  onMenu: (x: number, y: number) => void;
  onBlank: () => void;
  children: (layout: StageLayout) => ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const layout = layoutPages(p.sizes, w);
  const at = (cx: number, cy: number) => {
    const b = stage.current?.getBoundingClientRect();
    return { x: cx - (b?.left ?? 0), y: cy - (b?.top ?? 0) };
  };
  const pagesRef = useRef(layout.pages);
  pagesRef.current = layout.pages;
  const nonce = p.scrollTo?.nonce;
  const target = p.scrollTo?.index;
  useEffect(() => {
    const pg = nonce !== undefined && target !== undefined ? pagesRef.current[target] : undefined;
    if (pg) scroller.current?.scrollTo({ top: pg.top - 8, behavior: "smooth" });
  }, [nonce, target]);
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const down = (e: PointerEvent) => {
    // Menu chuột phải (Radix, portal) vẫn chuyền sự kiện React lên đây: bỏ qua thao tác không nằm trong sân khấu thật, kẻo đóng menu trước khi chọn.
    if (!isInsideStage(stage.current, e.target)) return;
    p.onBlank();
    if (e.pointerType === "mouse") return;
    const { x, y } = at(e.clientX, e.clientY);
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => p.onMenu(x, y), LONG_PRESS_MS),
    };
  };
  const moveP = (e: PointerEvent) => {
    const s = press.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_CANCEL_PX) cancel();
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const { x, y } = at(e.clientX, e.clientY);
    if (id) p.onDropTray(id, x, y);
  };
  const onScroll = () => {
    const el = scroller.current;
    const top = (el?.scrollTop ?? 0) + (el?.clientHeight ?? 0) / 3;
    const cur = layout.pages.findIndex((g) => top < g.top + g.height + 8);
    p.onCurrentPage(Math.max(0, cur));
  };
  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="relative min-w-0 flex-1 overflow-auto bg-muted pb-[var(--fab-safe)]"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: sân khấu kéo-thả/chuột phải; mọi thao tác đều có đường bàn phím ở từng ô */}
      <div
        ref={stage}
        data-testid="sign-stage"
        className="relative"
        style={{ width: layout.width, height: layout.height }}
        onPointerDown={down}
        onPointerMove={moveP}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop}
        onContextMenu={(e) => {
          e.preventDefault();
          const { x, y } = at(e.clientX, e.clientY);
          p.onMenu(x, y);
        }}
      >
        {layout.pages.map((g) => (
          <PageCanvas key={g.index} doc={p.doc} page={g} />
        ))}
        {p.children(layout)}
      </div>
    </div>
  );
}
