// CR-149 · PDF bằng pdf.js (nạp lười; worker đóng gói cục bộ, không CDN): cuộn các trang, phóng to/thu nhỏ. Trang vẽ khi cuộn tới.
import { Button } from "@ai/web-kit/ui/kit/button";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type OpenedPdf, openPdf } from "~/lib/pdf-worker";

const STEPS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3];

function PdfPage({ doc, n, scale }: { doc: PDFDocumentProxy; n: number; scale: number }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setSeen(true), {
      rootMargin: "400px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    let task: { cancel: () => void } | undefined;
    let dead = false;
    void doc.getPage(n).then((page) => {
      const vp = page.getViewport({ scale });
      if (dead) return;
      setSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) });
      const c = canvas.current;
      if (!seen || !c) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      const r = page.render({
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
  }, [doc, n, scale, seen]);
  return (
    <div
      ref={box}
      className="mx-auto mb-2 bg-white shadow"
      style={{ width: size?.w ?? 600 * scale, height: size?.h ?? 800 * scale }}
      data-testid="pdf-page"
      role="img"
      aria-label={t("contracts.fview.page", { n })}
    >
      <canvas ref={canvas} style={{ width: size?.w, height: size?.h }} />
    </div>
  );
}

export default function PdfPane({ blob, onError }: { blob: Blob; onError: () => void }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [si, setSi] = useState(2);
  // CR-193 BR-193-8: 100% = vừa bề rộng khung (trang 1), không cuộn ngang.
  const wrap = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    let dead = false;
    let opened: OpenedPdf | undefined;
    (async () => {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (dead) return;
      opened = await openPdf(data);
      if (dead) return void opened.dispose(); // đã huỷ trong lúc dựng Worker
      const d = await opened.task.promise;
      if (!dead) setDoc(d);
    })().catch((e: unknown) => {
      if (!dead) console.error("[file-viewer] không mở được PDF", e);
      if (!dead) onError();
    });
    return () => {
      dead = true;
      void opened?.dispose();
    };
  }, [blob, onError]);
  useEffect(() => {
    const el = wrap.current;
    if (!doc || !el) return;
    let dead = false;
    void doc.getPage(1).then((page) => {
      const pw = page.getViewport({ scale: 1 }).width;
      const apply = () => {
        const w = el.clientWidth - 16; // đệm p-2 hai bên
        if (!dead && w > 0 && pw > 0) setFit(Math.max(0.3, w / pw));
      };
      apply();
      const ro = new ResizeObserver(apply);
      ro.observe(el);
      cleanup = () => ro.disconnect();
    });
    let cleanup = () => {};
    return () => {
      dead = true;
      cleanup();
    };
  }, [doc]);
  if (!doc) return <p className="p-4 text-label text-dim">{t("contracts.fview.loading")}</p>;
  const scale = fit * (STEPS[si] ?? 1);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="pdf-viewer">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("contracts.fview.zoomOut")}
          disabled={si === 0}
          onClick={() => setSi(si - 1)}
        >
          −
        </Button>
        <span className="w-12 text-center text-sm tabular-nums">
          {Math.round((STEPS[si] ?? 1) * 100)}%
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("contracts.fview.zoomIn")}
          disabled={si === STEPS.length - 1}
          onClick={() => setSi(si + 1)}
        >
          +
        </Button>
      </div>
      <div
        ref={wrap}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-rule bg-sunk p-2"
      >
        {Array.from({ length: doc.numPages }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: số trang là khoá ổn định
          <PdfPage key={i} doc={doc} n={i + 1} scale={scale} />
        ))}
      </div>
    </div>
  );
}
