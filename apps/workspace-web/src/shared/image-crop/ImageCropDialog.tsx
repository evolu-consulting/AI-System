// CR-192 · hộp cắt ảnh hồ sơ: kéo để chọn vùng, thanh phóng 1–3×; đại diện khung tròn, bìa khung 3:1. Canvas thuần, không thư viện.
import { Button } from "@ai/web-kit/ui/kit/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { CROP, clampZoom, cropRect, panCenter, ZOOM_MAX, ZOOM_MIN } from "./crop";
import type { ImageKind } from "./image";
import type { Source } from "./image-file";

const VIEW_W = 288;

export type CropLabels = {
  title: string;
  drag: string;
  zoom: string;
  cancel: string;
  save: string;
};

export function ImageCropDialog({
  kind,
  labels,
  src,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: ImageKind;
  labels: CropLabels;
  src: Source;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (rect: ReturnType<typeof cropRect>) => void;
}) {
  const spec = CROP[kind];
  const viewH = Math.round(VIEW_W / spec.aspect);
  const [zoom, setZoom] = useState(1);
  const [c, setC] = useState({ cx: src.width / 2, cy: src.height / 2 });
  const rect = cropRect({ w: src.width, h: src.height }, spec.aspect, zoom, c);
  // Canvas nằm trong Portal của Radix (gắn SAU lần render đầu) ⇒ giữ trong state: gắn xong thì render lại và hiệu ứng vẽ chạy (useRef để lại khung trống).
  const [cv, setCv] = useState<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!cv) return;
    cv.getContext("2d")?.drawImage(
      src.draw,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      0,
      0,
      cv.width,
      cv.height,
    );
  });

  const move = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = { x: e.clientX, y: e.clientY };
      setC(panCenter(rect, VIEW_W, e.clientX - d.x, e.clientY - d.y));
    },
    [rect],
  );
  const nudge = (e: React.KeyboardEvent) => {
    const step = 12;
    const d = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }[e.key];
    if (!d) return;
    e.preventDefault();
    setC(panCenter(rect, VIEW_W, d[0] as number, d[1] as number));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-[360px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3" data-testid="crop-dialog">
          <canvas
            ref={setCv}
            width={VIEW_W * 2}
            height={viewH * 2}
            data-testid="crop-view"
            tabIndex={0}
            aria-label={labels.drag}
            className={`touch-none cursor-grab bg-muted active:cursor-grabbing ${kind === "avatar" ? "rounded-full" : "rounded-md"}`}
            style={{ width: VIEW_W, height: viewH }}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={nudge}
          />
          <p className="m-0 text-xs text-muted-foreground">{labels.drag}</p>
          <label className="flex w-full items-center gap-2 text-sm">
            <span className="shrink-0">{labels.zoom}</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              value={zoom}
              data-testid="crop-zoom"
              className="min-w-0 flex-1"
              aria-label={labels.zoom}
              onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
            />
          </label>
          <div className="flex w-full justify-end gap-2">
            <Button variant="quiet" disabled={busy} data-testid="crop-cancel" onClick={onCancel}>
              {labels.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              data-testid="crop-save"
              onClick={() => onConfirm(rect)}
            >
              {labels.save}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
