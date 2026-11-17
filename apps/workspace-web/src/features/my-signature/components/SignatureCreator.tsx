// CR-181 · s3 · tạo chữ ký (vẽ / tải ảnh / gõ họ tên) + khung «Trên tài liệu sẽ trông như sau». Thuần UI: chưa gọi API,
// lưu xong gọi `onSave(png, cách)`. PNG là nét đen nền trong suốt (Q18); màu mực chỉ để xem trước.
import { Button } from "@ai/web-kit/ui/kit/button";
import { Field } from "@ai/web-kit/ui/kit/field";
import { Input } from "@ai/web-kit/ui/kit/input";
import { ToggleGroup, ToggleGroupItem } from "@ai/web-kit/ui/kit/toggle-group";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  allowedMethods,
  type CaptionFields,
  canvasFromImageFile,
  canvasFromName,
  captionText,
  drawPreview,
  type Ink,
  loadSignatureFont,
  type Method,
  missingError,
  toSignaturePng,
  trimCanvas,
} from "../lib/signature-image";

const PAD_W = 900;
const PAD_H = 300;

export type SignatureCreatorProps = {
  methods: Record<Method, boolean> | Method[];
  ink: Ink;
  caption: CaptionFields;
  person: { name: string; title?: string };
  allowLater: boolean;
  step: "main" | "initials";
  onSave: (png: Blob, method: Method) => void;
  onLater?: () => void;
};

export function SignatureCreator(p: SignatureCreatorProps) {
  const { t } = useTranslation();
  const list = allowedMethods(p.methods);
  const [how, setHow] = useState<Method>(list[0] ?? "draw");
  const cur = list.includes(how) ? how : (list[0] ?? "draw");
  const [name, setName] = useState(p.person.name);
  const [drawn, setDrawn] = useState(false);
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null);
  const prev = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);

  /** Canvas chữ ký hiện tại theo cách đang chọn (đã cắt sát) hoặc null nếu chưa có. */
  const current = async () => {
    if (cur === "draw") return drawn && pad.current ? trimCanvas(pad.current) : null;
    if (cur === "upload") return upload;
    return canvasFromName(name);
  };
  const captionLine = captionText(p.caption, {
    name: p.person.name,
    title: p.person.title,
    date: new Date(),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: vẽ lại khi đổi cách/nét/tên/ảnh/mực/dòng dưới
  useEffect(() => {
    let live = true;
    void current().then((c) => {
      if (live && prev.current) drawPreview(prev.current, c, p.ink, captionLine);
    });
    return () => {
      live = false;
    };
  }, [cur, drawn, name, upload, p.ink, captionLine]);

  useEffect(() => {
    if (cur === "type") void loadSignatureFont();
  }, [cur]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * PAD_W) / r.width, ((e.clientY - r.top) * PAD_H) / r.height];
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = pad.current?.getContext("2d");
    if (!x) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    x.lineWidth = 6;
    x.lineCap = x.lineJoin = "round";
    x.strokeStyle = "#000";
    const pt = at(e);
    last.current = pt;
    x.beginPath();
    x.moveTo(pt[0], pt[1]);
    x.lineTo(pt[0] + 0.01, pt[1]);
    x.stroke();
    setError(null);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    const x = pad.current?.getContext("2d");
    if (!from || !x) return;
    const pt = at(e);
    x.beginPath();
    x.moveTo(from[0], from[1]);
    x.lineTo(pt[0], pt[1]);
    x.stroke();
    last.current = pt;
  };
  const up = () => {
    if (last.current) setDrawn(true);
    last.current = null;
  };
  const clear = () => {
    pad.current?.getContext("2d")?.clearRect(0, 0, PAD_W, PAD_H);
    setDrawn(false);
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const c = await canvasFromImageFile(f);
    if (!c) return setError(t("contracts.mySig.errRead"));
    setError(null);
    setUpload(c);
  };
  const save = async () => {
    const miss = missingError(cur, { drawn, upload: Boolean(upload), name });
    if (miss) return setError(t(`contracts.mySig.${miss}`));
    setBusy(true);
    try {
      const c = await current();
      if (!c) return setError(t("contracts.mySig.errType"));
      setError(null);
      p.onSave(await toSignaturePng(c), cur);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="signature-creator" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">
        {p.step === "initials"
          ? t("contracts.mySig.titleInitials")
          : t("contracts.mySig.titleMain")}
      </h2>
      {list.length > 1 && (
        <ToggleGroup
          type="single"
          value={cur}
          onValueChange={(v) => {
            if (!v) return;
            setHow(v as Method);
            setError(null);
          }}
          aria-label={t("contracts.mySig.howAria")}
          className="self-start"
        >
          {list.map((m) => (
            <ToggleGroupItem key={m} value={m}>
              {t(`contracts.mySig.how.${m}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      <div hidden={cur !== "draw"} className="flex flex-col gap-2">
        <canvas
          ref={pad}
          width={PAD_W}
          height={PAD_H}
          aria-label={t("contracts.mySig.padAria")}
          className="w-full max-w-xl touch-none rounded-md border border-dashed bg-card"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{t("contracts.mySig.padHint")}</span>
          {drawn && (
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("contracts.mySig.clear")}
            </Button>
          )}
        </div>
      </div>

      {cur === "upload" && (
        <Field
          id="sig-file"
          label={t("contracts.mySig.pick")}
          description={t("contracts.mySig.uploadHint")}
        >
          <Input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </Field>
      )}

      {cur === "type" && (
        <Field id="sig-name" label={t("contracts.mySig.nameLabel")}>
          <Input
            value={name}
            placeholder={t("contracts.mySig.namePh")}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </Field>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{t("contracts.mySig.previewTitle")}</h3>
        <canvas
          ref={prev}
          width={700}
          height={260}
          role="img"
          aria-label={t("contracts.mySig.previewTitle")}
          className="w-full max-w-xl rounded-md border bg-card"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={save} busy={busy}>
          {t("contracts.mySig.save")}
        </Button>
        {p.allowLater && (
          <Button variant="ghost" onClick={p.onLater}>
            {t("contracts.mySig.later")}
          </Button>
        )}
      </div>
    </section>
  );
}
