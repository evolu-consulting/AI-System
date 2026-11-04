// V2-L · CD-06: mục "Điểm kinh doanh" — trọng số (tốc độ bán · biên lãi · xu hướng), ngưỡng Mua thêm / Xả hàng / Đẩy mạnh / Cân nhắc
// dừng, mục tiêu bán, báo sắp hết hạn; "thử tính" gọi `POST /business/config/preview` (server dùng đúng hàm chấm điểm).
import type { BizConfig, BizPreviewIn } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBizPreview } from "../hooks/use-settings";
import { same } from "../lib/data";
import { Thresholds } from "./BizThresholds";
import { Panel, Row, Seg } from "./controls";
import { TryBox, TryNum } from "./TryBox";

type Sample = BizPreviewIn["sample"];
const SAMPLE: Sample = {
  kind: "stock",
  held: 120,
  l3: 90,
  p3: 60,
  cost: 90_000,
  price: 120_000,
  dte: 200,
};
const W = ["rot", "margin", "trend"] as const;

function BizTry({ cfg }: { cfg: BizConfig }) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, string | number>) => t(`contracts.settings.biz.${k}`, o);
  const [x, setX] = useState<Sample>(SAMPLE);
  const [body, setBody] = useState<BizPreviewIn>({ config: cfg, sample: x });
  useEffect(() => {
    const id = setTimeout(() => setBody({ config: cfg, sample: x }), 500);
    return () => clearTimeout(id);
  }, [cfg, x]);
  const q = useBizPreview(body);
  const num = (k: "held" | "l3" | "p3" | "cost" | "price" | "dte", max: number) => (
    <div className="flex items-center justify-between text-caption">
      <span>{s(`s.${k}`)}</span>
      <TryNum
        label={s(`s.${k}`)}
        value={x[k]}
        min={0}
        max={max}
        onChange={(v) => setX({ ...x, [k]: v })}
      />
    </div>
  );
  return (
    <TryBox formula={[s("f1"), s("f2"), s("f3"), s("f4")]}>
      <div className="grid gap-2">
        <Seg
          label={s("s.kind")}
          value={x.kind}
          onChange={(kind) => setX({ ...x, kind })}
          options={[
            ["stock", s("k.stock")],
            ["quota", s("k.quota")],
            ["order", s("k.order")],
            ["referral", s("k.referral")],
          ]}
        />
        {num("held", 1e6)}
        {num("l3", 1e6)}
        {num("p3", 1e6)}
        {num("cost", 1e9)}
        {num("price", 1e9)}
        {x.kind === "quota" && num("dte", 3650)}
        <div className="border-t border-rule-soft pt-2 text-label" aria-live="polite">
          {q.isError && <span className="text-late">{s("tryError")}</span>}
          {q.data && (
            <div className="flex justify-between">
              <span>{s("result")}</span>
              <b data-testid="try-result" className="text-lg tabular-nums">
                {q.data.score ?? "—"}
                {q.data.suggestion ? ` · ${s(`sug.${q.data.suggestion}`)}` : ""}
              </b>
            </div>
          )}
          {q.data && <p className="text-caption text-dim">{q.data.reason}</p>}
        </div>
      </div>
    </TryBox>
  );
}

export function BizPane({
  value: v,
  defaults,
  set,
}: {
  value: BizConfig;
  defaults: BizConfig;
  set: (c: BizConfig) => void;
}) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.biz.${k}`);
  const tw = v.w.rot + v.w.margin + v.w.trend || 1;
  return (
    <>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{s("title")}</h2>
          <p className="text-caption text-dim">{s("sub")}</p>
        </div>
        <button
          type="button"
          disabled={same(v, defaults)}
          onClick={() => set(structuredClone(defaults))}
          className="h-8 rounded-lg border border-rule px-3 text-label text-ink-2 hover:bg-sunk disabled:opacity-50"
        >
          {t("contracts.settings.resetCell")}
        </button>
      </div>
      <Panel title={s("weights")}>
        {W.map((k) => (
          <Row key={k} label={s(`w.${k}`)}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={60}
                value={v.w[k]}
                aria-label={s(`w.${k}`)}
                className="flex-1 accent-[var(--primary)]"
                onChange={(e) => set({ ...v, w: { ...v.w, [k]: Number(e.target.value) } })}
              />
              <span className="w-10 text-right font-semibold text-act tabular-nums">
                {Math.round((v.w[k] / tw) * 100)}%
              </span>
            </div>
          </Row>
        ))}
      </Panel>
      <Thresholds v={v} set={set} />
      <BizTry cfg={v} />
    </>
  );
}
