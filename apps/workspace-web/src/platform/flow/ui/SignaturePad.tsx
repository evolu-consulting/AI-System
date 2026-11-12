// CR-127 · U4 · BR-21 · ô ký tay: canvas tự viết (không thư viện) — vẽ bằng chuột/ngón tay, «Xoá nét» để ký lại. Vẽ xong ⇒ `onChange(png)`
// (PNG ≤ 200 KB — canvas nhỏ nên đủ); trống ⇒ `onChange(null)`. Không biết gì về tải lên: chỗ dùng tự tải.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const W = 360;
const H = 120;

export function SignaturePad({
  onChange,
  disabled = false,
}: {
  onChange: (png: File | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.lineWidth = 2;
    c.lineCap = "round";
    c.strokeStyle = "#111";
  }, []);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height] as const;
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const c = ref.current?.getContext("2d");
    if (!c) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const [x, y] = at(e);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 0.01, y);
    c.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const [x, y] = at(e);
    c.lineTo(x, y);
    c.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setInked(true);
    ref.current?.toBlob((b) => {
      if (b) onChange(new File([b], "chu-ky.png", { type: "image/png" }));
    }, "image/png");
  };
  const clear = () => {
    ref.current?.getContext("2d")?.clearRect(0, 0, W, H);
    setInked(false);
    onChange(null);
  };
  return (
    <div data-testid="signature-pad">
      <canvas
        ref={ref}
        width={W}
        height={H}
        aria-label={t("contracts.work.u4.sign.aria")}
        className="w-full max-w-sm touch-none rounded-md border border-dashed border-rule bg-panel"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="mt-1 flex items-center gap-3 text-caption text-dim">
        <span>{inked ? t("contracts.work.u4.sign.done") : t("contracts.work.u4.sign.hint")}</span>
        {inked && (
          <button type="button" className="underline" data-testid="signature-clear" onClick={clear}>
            {t("contracts.work.u4.sign.clear")}
          </button>
        )}
      </div>
    </div>
  );
}
