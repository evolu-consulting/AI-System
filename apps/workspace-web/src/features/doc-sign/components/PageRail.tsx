// CR-181 · cột trang bên trái (ẩn ≤ 640px): ảnh nhỏ, chấm màu theo bên, bấm cuộn tới.

import type { SignSide } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export const SIDE_DOT: Record<SignSide | "mark", string> = {
  A: "bg-violet-500",
  B: "bg-orange-500",
  mark: "bg-primary",
};

function Thumb({ doc, n }: { doc: PDFDocumentProxy; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { cancel: () => void } | undefined;
    let dead = false;
    void doc.getPage(n).then((page) => {
      const c = ref.current;
      if (dead || !c) return;
      const vp = page.getViewport({ scale: 0.2 });
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const r = page.render({ canvas: c, viewport: vp });
      task = r;
      r.promise.catch(() => undefined);
    });
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, n]);
  return <canvas ref={ref} className="mx-auto block h-auto max-w-full border bg-white" />;
}

export function PageRail(p: {
  doc: PDFDocumentProxy;
  pageCount: number;
  dots: Record<number, (SignSide | "mark")[]>;
  current: number;
  onGo: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("contracts.docsign.rail")}
      className="hidden w-28 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-muted/40 p-2 sm:flex"
    >
      {[...Array(p.pageCount).keys()].map((i) => (
        <Button
          key={`page-${i + 1}`}
          variant="quiet"
          className={`h-auto w-full min-w-0 flex-col gap-1 p-1 ${p.current === i ? "bg-accent" : ""}`}
          aria-label={t("contracts.docsign.railPage", { n: i + 1 })}
          aria-current={p.current === i ? "true" : undefined}
          onClick={() => p.onGo(i)}
        >
          <Thumb doc={p.doc} n={i + 1} />
          <span className="flex items-center gap-1 text-xs">
            {i + 1}
            {(p.dots[i] ?? []).map((d, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: chấm thứ tự, không đổi chỗ
              <span key={`${d}-${k}`} className={`size-2 rounded-full ${SIDE_DOT[d]}`} />
            ))}
          </span>
        </Button>
      ))}
    </nav>
  );
}
